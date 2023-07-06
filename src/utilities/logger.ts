import { ExtensionContext, LogOutputChannel, window } from "vscode";

let channel: LogOutputChannel | undefined;

// Create first.
export function activateLogger(context: ExtensionContext, name: string) {
  channel = window.createOutputChannel(name, { log: true });
}

// Dispose the last one
export function setupDisposeLogger(context: ExtensionContext) {
  if (!channel) {
    return;
  }

  // Replace the functionality, as it does not provide a way to know that it has been destroyed.
  const disposeChannel = channel.dispose;
  channel.dispose = () => {
    disposeChannel.apply(channel);
    channel = undefined;
    console.log("Channel disposed!!!");
  };

  context.subscriptions.push(channel);
}

export function log(value: string) {
  if (channel) {
    try {
      channel.appendLine(value);
    } catch (e) {
      console.error("Error:logger.ts", e);
    }
  } else {
    console.log(value);
  }
}
export function logError(value: string) {
  if (channel) {
    try {
      channel.error(value);
    } catch (e) {
      console.error("Error:logger.ts", e);
    }
  } else {
    console.log(value);
  }
}
