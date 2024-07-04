import type { NotebookCellKind, Uri } from "vscode";
import type { RunResultMetadata } from "../shared/RunResultMetadata";

export type SQLMode = "Query" | "Explain" | "ExplainAnalyze";

export type CellMetaChart = {
  title: string;
  type: "bar" | "doughnut" | "line" | "pie" | "radar" | "scatter" | "pairPlot" | "histogram";
  multipleDataset: boolean;
  showDataLabels: boolean;
  showTitle: boolean;
  stacked?: boolean;
  label: string;
  data: string;
  dataX: string;
  dataY: string;
  data2?: string;
  data3?: string;
  data4?: string;
};

export type CellMeta = {
  markAsSkip?: boolean;
  markAsRunInOrderAtJsonCell?: boolean;
  connectionName?: string;
  showComment?: boolean;
  ruleFile?: string;
  codeResolverFile?: string;
  sharedVariableName?: string;
  chart?: CellMetaChart;
  readonly [key: string]: any;
};

export type NotebookMeta = {
  readonly [key: string]: any;
};

export type RawNotebookData = {
  cells: RawNotebookCell[];
  metadata?: NotebookMeta;
};

export type RawNotebookCell = {
  language: string;
  value: string;
  kind: NotebookCellKind;
  editable?: boolean;
  metadata?: CellMeta;
};

export type NotebookExecutionVariables = {
  _skipSql?: boolean;
  [key: string]: any;
};

export type RunResult = {
  stdout: string;
  stderr: string;
  skipped: boolean;
  status: "skipped" | "executed" | "error";
  metadata?: RunResultMetadata;
};

export type NotebookToolbarClickEvent = {
  notebookEditor: { notebookUri: Uri };
  ui: boolean;
};
