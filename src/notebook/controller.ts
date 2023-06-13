import {
  NOTEBOOK_TYPE,
  CELL_OPEN_MDH,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CELL_SPECIFY_RULES_TO_USE,
  CELL_TOGGLE_SHOW_COMMENT,
  CELL_WRITE_TO_CLIPBOARD,
} from "../constant";
import { NodeKernel } from "./NodeKernel";
import { StateStorage } from "../utilities/StateStorage";
import {
  ResultSetData,
  ResultSetDataBuilder,
  runRuleEngine,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta, RunResult } from "../types/Notebook";
import { abbr } from "../utilities/stringUtil";
import { setupDbResource } from "./intellisense";
import {
  ExtensionContext,
  NotebookCell,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookCellStatusBarAlignment,
  NotebookCellStatusBarItem,
  NotebookCellStatusBarItemProvider,
  NotebookController,
  NotebookDocument,
  Uri,
  commands,
  notebooks,
  workspace,
} from "vscode";
import { log } from "../utilities/logger";
import { sqlKernelRun } from "./sqlKernel";
import path = require("path");
import { existsRuleFile, isJsonCell, isSqlCell, readRuleFile } from "../utilities/notebookUtil";
import { jsonKernelRun } from "./jsonKernel";

const PREFIX = "[DBNotebookController]";

const hasMessageField = (error: any): error is { message: string } => {
  if ("message" in error && typeof error.message === "string") {
    return true;
  } else {
    return false;
  }
};

export class MainController {
  readonly controllerId = `${NOTEBOOK_TYPE}-controller`;
  readonly notebookType = NOTEBOOK_TYPE;
  readonly label = "Database Notebook";
  readonly supportedLanguages = ["sql", "javascript", "json"];
  private kernel: NodeKernel | undefined;

  private _executionOrder = 0;
  private readonly _controller: NotebookController;
  private currentVariables: { [key: string]: any } | undefined;
  private interrupted: boolean = false;

  constructor(private context: ExtensionContext, private stateStorage: StateStorage) {
    this._controller = notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this._controller.supportedLanguages = this.supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._executeAll.bind(this);
    this._controller.interruptHandler = this._interruptHandler.bind(this);

    context.subscriptions.push(
      workspace.onDidChangeNotebookDocument((e) => {
        this.setActiveContext(e.notebook);
      })
    );
    context.subscriptions.push(
      workspace.onDidOpenNotebookDocument((notebook) => {
        this.setActiveContext(notebook);
      })
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new ConnectionSettingProvider(stateStorage)
      )
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new CommentProvider())
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new RecordRuleProvider(stateStorage)
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new WriteToClipboardProvider()
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new RdhProvider())
    );
  }

  setActiveContext(notebook: NotebookDocument) {
    const cells = notebook?.getCells() ?? [];
    const visibleVariables = cells.some((cell) => cell.outputs.length > 0);
    const visibleRdh = cells.some(
      (cell) =>
        isSqlCell(cell) && cell.outputs.length > 0 && cell.outputs[0].metadata?.rdh !== undefined
    );
    const hasSql = cells.some((cell) => isSqlCell(cell));
    commands.executeCommand("setContext", "visibleVariables", visibleVariables);
    commands.executeCommand("setContext", "visibleRdh", visibleRdh);
    commands.executeCommand("setContext", "hasSql", hasSql);
  }

  getVariables() {
    return this.currentVariables;
  }

  dispose(): void {
    this._controller.dispose();
  }

  private _interruptHandler(notebook: NotebookDocument): void | Thenable<void> {
    log(`${PREFIX} interruptHandler`);
    this.interrupted = true;
    if (this.kernel) {
      this.kernel.interrupt();
    }
  }

  private async _executeAll(
    cells: NotebookCell[],
    notebook: NotebookDocument,
    _controller: NotebookController
  ): Promise<void> {
    this.interrupted = false;
    const connectionSettings = await this.stateStorage.getConnectionSettingList();
    this.kernel = new NodeKernel(connectionSettings);

    for (let cell of cells) {
      if (this.interrupted) {
        break;
      }
      await this._doExecution(notebook, cell);
    }
    this.currentVariables = this.kernel.getStoredVariables();
    await this.kernel.dispose();
    this.kernel = undefined;
    // this.setActiveContext();
  }

  private async _doExecution(notebook: NotebookDocument, cell: NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);

    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    const outputs: NotebookCellOutput[] = [];
    let success = true;
    try {
      const { stdout, stderr, metadata } = await this.run(notebook, cell);
      if (stdout.length) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.text(stdout)], metadata));
      }
      if (stderr) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.stdout(stderr)]));
        success = false;
      }
      if (metadata?.rdh) {
        const withComment = metadata.rdh.keys.some((it) => (it.comment ?? "").length);
        outputs.push(
          new NotebookCellOutput(
            [
              NotebookCellOutputItem.text(
                ResultSetDataBuilder.from(metadata.rdh).toMarkdown({
                  withComment,
                }),
                "text/markdown"
              ),
            ],
            metadata
          )
        );
      }
    } catch (err: any) {
      console.error(err);
      success = false;
      if (hasMessageField(err)) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.stdout(err.message)]));
      } else {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.error(err)]));
      }
    }
    execution.replaceOutput(outputs);
    execution.end(success, Date.now());
  }

  private async run(notebook: NotebookDocument, cell: NotebookCell): Promise<RunResult> {
    if (!this.kernel) {
      throw new Error("Missing kernel");
    }
    if (isSqlCell(cell)) {
      const r = await sqlKernelRun(cell, this.stateStorage, this.kernel.getStoredVariables());
      const metadata: CellMeta = cell.metadata;
      if (
        r.metadata?.rdh?.meta?.type === "select" &&
        metadata.ruleFile &&
        (await existsRuleFile(metadata.ruleFile))
      ) {
        const rrule = await readRuleFile(cell);
        if (rrule) {
          r.metadata.rdh.meta.tableRule = rrule.tableRule;
          const runRuleEngineResult = await runRuleEngine(r.metadata.rdh);
          log(`${PREFIX} runRuleEngineResult:${runRuleEngineResult}`);
        }
      }
      return r;
    } else if (isJsonCell(cell)) {
      return await jsonKernelRun(cell, this.kernel);
    }

    return this.kernel!.run(cell);
  }
}

// --- status bar
class RecordRuleProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (!isSqlCell(cell)) {
      return undefined;
    }
    if (!cell.document.getText().toLocaleLowerCase().includes("select")) {
      return undefined;
    }

    const { ruleFile }: CellMeta = cell.metadata;
    let tooltip = "";
    if (ruleFile) {
      let displayFileName = ruleFile;
      if (displayFileName.endsWith(".rrule")) {
        displayFileName = displayFileName.substring(0, displayFileName.length - 6);
      }
      if (await existsRuleFile(ruleFile)) {
        tooltip = "$(checklist) Use " + abbr(displayFileName, 18);
      } else {
        tooltip = "$(warning) Missing Rule " + abbr(displayFileName, 18);
      }
    } else {
      tooltip = "$(info) Specify Rule";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_RULES_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

class CommentProvider implements NotebookCellStatusBarItemProvider {
  constructor() {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (!isSqlCell(cell)) {
      return undefined;
    }

    const { showComment }: CellMeta = cell.metadata;
    let tooltip = "";
    if (showComment === true) {
      tooltip = "$(eye-closed) Hide comment";
    } else {
      tooltip = "$(eye) Show comment";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_TOGGLE_SHOW_COMMENT;
    item.tooltip = tooltip;
    return item;
  }
}

class ConnectionSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isSqlCell(cell)) {
      return undefined;
    }

    const { connectionName }: CellMeta = cell.metadata;
    let tooltip = "";
    if (connectionName) {
      if (this.stateStorage.hasConnectionSettingByName(connectionName)) {
        tooltip = "$(debug-disconnect) Use " + abbr(connectionName, 16);
        setupDbResource(connectionName);
      } else {
        tooltip = "$(error) Missing connection " + abbr(connectionName, 16);
      }
    } else {
      tooltip = "$(error) Specify connection";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_CONNECTION_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

class WriteToClipboardProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    const rdh = <ResultSetData | undefined>cell.outputs[0]?.metadata?.["rdh"];
    if (!rdh) {
      return;
    }
    const item = new NotebookCellStatusBarItem(
      "$(clippy) Write to clipbaord",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_WRITE_TO_CLIPBOARD;
    item.tooltip = "Write to clipbaord";
    return item;
  }
}

class RdhProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    const rdh = <ResultSetData | undefined>cell.outputs[0]?.metadata?.["rdh"];
    if (!rdh) {
      return;
    }
    const item = new NotebookCellStatusBarItem(
      "$(table) Open results",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_OPEN_MDH;
    item.tooltip = "Open results in panel";
    return item;
  }
}
