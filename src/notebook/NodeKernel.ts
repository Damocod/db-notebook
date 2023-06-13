import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";

const baseDir = path.join(__filename, "..", "..", "..");
const nodeModules = path.join(baseDir, "node_modules");

const winToLinuxPath = (s: string) => s.replace(/\\/g, "/");

export class NodeKernel {
  private tmpDirectory: string;
  private variablesFile: string;
  private scriptFile?: string;
  private time: number;
  private child: cp.ChildProcess | undefined;
  private variables: NotebookExecutionVariables;

  constructor(private connectionSettings: ConnectionSetting[]) {
    this.time = new Date().getTime();
    this.tmpDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "db-nodebook-"));
    this.variablesFile = winToLinuxPath(path.join(this.tmpDirectory, `store_${this.time}.json`));
    this.variables = {};
  }

  getStoredVariables(): NotebookExecutionVariables {
    return this.variables;
  }

  updateVariable(key: string, val: any) {
    this.variables[key] = val;
  }

  private async createScript(cell: vscode.NotebookCell): Promise<string> {
    const variablesJsonString = JSON.stringify(this.variables);

    return `
    (async () => {
      const myfs = require('fs');
      const variables = require('${winToLinuxPath(path.join(nodeModules, "store"))}');
      const mdd = require('${winToLinuxPath(
        path.join(nodeModules, "@l-v-yonsama/multi-platform-database-drivers")
      )}');
      const driverResolver = mdd.DBDriverResolver;
      const getConnectionSettingByName = (s) => {
        const settings = ${JSON.stringify(this.connectionSettings)};
        const o = settings.find(it => it.name == s);
        if (o) {
          return o;
        }
        const names = settings.map(it => it.name).join(',');
        throw new Error('Connection settings not found. Available here [' + names + '].');
      };

      const _saveVariables = () => {
        const saveMap = {};
        variables.each(function(value, key) {
          saveMap[key] = value;
        });
        myfs.writeFileSync('${this.variablesFile}', JSON.stringify(saveMap), {encoding:'utf8'});
      };
      const _skipSql = (b) => { variables.set('_skipSql', b); };
      try {
        const o = ${variablesJsonString};
        Object.keys(o).forEach(key =>{
          variables.set(key, o[key]);
        });
      } catch(_){
        console.error(_);
      }
  
      try {
        ${cell.document.getText()}
        ;
        _saveVariables();
      } catch(e) {
        console.error(e);
      }
    })();
    `;
  }

  public async run(cell: vscode.NotebookCell): Promise<RunResult> {
    const ext = cell.document.languageId === "javascript" ? "js" : "ts";
    const scriptName = `script_${this.time}.${ext}`;
    this.scriptFile = path.join(this.tmpDirectory, scriptName);

    const script = await this.createScript(cell);
    fs.writeFileSync(winToLinuxPath(this.scriptFile), script);

    // if (ext === "js") {
    this.child = cp.spawn("node", [this.scriptFile]);

    this.variables = JSON.parse(
      await fs.promises.readFile(this.variablesFile, { encoding: "utf8" })
    );
    let stdout = "";
    let stderr = "";

    const promise = new Promise((resolve, reject) => {
      if (this.child) {
        if (this.child.stdout) {
          this.child.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
          });
        }
        if (this.child.stderr) {
          this.child.stderr.on("data", (data) => {
            stderr += data.toString();
          });
        }
        this.child.on("error", reject);
        this.child.on("close", (code) => {
          resolve(code);
        });
      } else {
        reject();
      }
    });
    await promise;

    const reg = new RegExp(".*" + path.basename(this.scriptFile) + ":[0-9]+\r?\n *");
    stderr = stderr.replace(reg, "");
    stderr = stderr.replace(/ +at +[a-zA-Z0-9()/. :_\[\]-]+/g, "");
    stderr = stderr.replace(/Node.js v[0-9.:-]+/, "");
    stderr = stderr.replace(/\r\n/g, "\n");
    stderr = stderr.replace(/\n+/g, "\n");

    return {
      stdout,
      stderr,
    };
  }

  interrupt() {
    if (this.child) {
      process.kill(this.child.pid);
      this.child = undefined;
    }
  }

  async dispose() {
    this.child = undefined;
    await fs.promises.rm(this.tmpDirectory, { recursive: true });
  }
}
