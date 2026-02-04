const vscode = require('vscode');

const RISK = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

function normalizeArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getExtensionKind(extension) {
  const kind = extension.packageJSON.extensionKind;
  if (!kind) {
    return [];
  }
  return normalizeArray(kind);
}

function assessRisk(extension) {
  const pkg = extension.packageJSON || {};
  const activationEvents = normalizeArray(pkg.activationEvents);
  const kinds = getExtensionKind(extension);

  let score = 0;
  const reasons = [];

  if (activationEvents.includes('*')) {
    score += 3;
    reasons.push('Activates on all events');
  }

  if (activationEvents.includes('onStartupFinished')) {
    score += 2;
    reasons.push('Activates on startup');
  }

  const runsInWorkspace = kinds.includes('workspace') || kinds.length === 0;
  if (runsInWorkspace) {
    score += 2;
    reasons.push('Runs in workspace (filesystem access)');
  }

  if (pkg.main && runsInWorkspace) {
    score += 1;
    reasons.push('Runs Node.js extension host code');
  }

  let level = RISK.LOW;
  if (score >= 5) {
    level = RISK.HIGH;
  } else if (score >= 3) {
    level = RISK.MEDIUM;
  }

  return { level, score, reasons };
}

function riskLabel(level) {
  if (level === RISK.HIGH) {
    return 'High';
  }
  if (level === RISK.MEDIUM) {
    return 'Medium';
  }
  return 'Low';
}

function riskIcon(level) {
  if (level === RISK.HIGH) {
    return new vscode.ThemeIcon('error');
  }
  if (level === RISK.MEDIUM) {
    return new vscode.ThemeIcon('warning');
  }
  return new vscode.ThemeIcon('check');
}

class ExtensionItem extends vscode.TreeItem {
  constructor(extension, assessment) {
    super(extension.packageJSON.displayName || extension.packageJSON.name || extension.id, vscode.TreeItemCollapsibleState.None);
    this.extension = extension;
    this.contextValue = 'trustLens.extension';
    this.iconPath = riskIcon(assessment.level);

    const publisher = extension.packageJSON.publisher ? extension.packageJSON.publisher : extension.id.split('.')[0];
    const name = extension.packageJSON.name || extension.id.split('.')[1] || extension.id;
    this.description = `${publisher}.${name} | ${riskLabel(assessment.level)}`;

    const lines = [];
    lines.push(`Risk: ${riskLabel(assessment.level)}`);
    lines.push(`Version: ${extension.packageJSON.version || 'unknown'}`);
    lines.push(`ID: ${extension.id}`);
    if (assessment.reasons.length) {
      lines.push('');
      lines.push('Reasons:');
      assessment.reasons.forEach((reason) => lines.push(`- ${reason}`));
    }
    this.tooltip = lines.join('\n');
  }
}

class TrustLensProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    const extensions = vscode.extensions.all
      .filter((ext) => !ext.packageJSON.isBuiltin)
      .map((ext) => ({
        extension: ext,
        assessment: assessRisk(ext)
      }))
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        const diff = order[a.assessment.level] - order[b.assessment.level];
        if (diff !== 0) {
          return diff;
        }
        const aName = (a.extension.packageJSON.displayName || a.extension.id).toLowerCase();
        const bName = (b.extension.packageJSON.displayName || b.extension.id).toLowerCase();
        return aName.localeCompare(bName);
      });

    if (!extensions.length) {
      return [new vscode.TreeItem('No extensions found.')];
    }

    return extensions.map((item) => new ExtensionItem(item.extension, item.assessment));
  }
}

async function disableExtension(item) {
  if (!item || !item.extension) {
    return;
  }
  await vscode.commands.executeCommand('workbench.extensions.disableExtension', item.extension.id);
}

async function uninstallExtension(item) {
  if (!item || !item.extension) {
    return;
  }
  await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', item.extension.id);
}

function activate(context) {
  const provider = new TrustLensProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('trustLensReport', provider),
    vscode.commands.registerCommand('trustLens.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('trustLens.disable', (item) => disableExtension(item)),
    vscode.commands.registerCommand('trustLens.uninstall', (item) => uninstallExtension(item))
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};