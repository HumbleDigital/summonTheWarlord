#!/usr/bin/env node
import { Command } from "commander";
import {
  getConfigPath,
  loadConfig,
  saveConfig,
  editConfig,
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  parseConfigValue,
  normalizeConfigValue,
  PRIORITY_FEE_LEVELS,
  TX_VERSIONS,
} from "./lib/config.js";
import {
  storePrivateKey,
  getPrivateKey,
  deletePrivateKey,
  hasPrivateKey,
  storeRaptorApiKey,
  hasRaptorApiKey,
  deleteRaptorApiKey,
  getRaptorApiKey,
} from "./utils/keychain.js";
import readline from "readline";
import { notify } from "./utils/notify.js";
import { runDoctor } from "./lib/doctor.js";
import { MINT_EXAMPLE, getAmountExamples, validateTradeInput } from "./lib/tradeInput.js";

const program = new Command();
program
  .name("summon")
  .description("Summon Solana CLI")
  .showHelpAfterError(); // show help after invalid flags/args

const CONFIG_KEY_SET = new Set([
  ...CONFIG_KEYS.filter((key) => key !== "jito" && key !== "tip"),
  "jito.enabled",
  "jito.tip",
  "tip.enabled",
  "tip.sol",
  "tip.account",
  "tip.lamports",
]);
const CONFIG_HELP = [
  { key: "rpcUrl", type: "string", note: "RPC URL (advancedTx=true is enforced)" },
  { key: "raptorBaseUrl", type: "string", note: "Raptor swap API base URL" },
  { key: "slippage", type: "number | auto", note: "Max slippage percentage (auto → dynamic bps)" },
  { key: "priorityFee", type: "auto | level | microlamports", note: "Priority fee mode for Raptor" },
  {
    key: "priorityFeeLevel",
    type: PRIORITY_FEE_LEVELS.join(" | "),
    note: "Used when priorityFee=auto",
  },
  { key: "maxPriorityFee", type: "number | empty", note: "Cap dynamic priority fees (lamports)" },
  { key: "computeUnitPriceMicroLamports", type: "number | empty", note: "Override CU price" },
  { key: "computeUnitLimit", type: "number | empty", note: "Override CU limit" },
  { key: "txVersion", type: TX_VERSIONS.join(" | "), note: "Transaction version (sent as V0/LEGACY)" },
  { key: "wrapUnwrapSol", type: "true | false", note: "Auto wrap/unwrap SOL in swaps" },
  { key: "dexes", type: "string", note: "Comma-separated DEX allowlist" },
  { key: "pools", type: "string", note: "Comma-separated pool allowlist" },
  { key: "maxHops", type: "number | empty", note: "Max route hops (1-4)" },
  { key: "onlyDirectRoutes", type: "true | false", note: "Force direct routes only" },
  { key: "destinationTokenAccount", type: "string", note: "Optional destination token account" },
  { key: "chargeBps", type: "number | empty", note: "Extra charge on positive slippage (bps)" },
  { key: "tip.enabled", type: "true | false", note: "Attach SOL tip to swap" },
  { key: "tip.sol", type: "number", note: "Tip amount in SOL (converted to lamports)" },
  { key: "tip.account", type: "string", note: "Optional tip account pubkey" },
  { key: "tip.lamports", type: "number | empty", note: "Tip amount in lamports (overrides tip.sol)" },
  { key: "showQuoteDetails", type: "true | false", note: "Print quote details after swaps" },
  { key: "DEBUG_MODE", type: "true | false", note: "Enable verbose logs" },
  { key: "notificationsEnabled", type: "true | false", note: "Enable macOS notifications" },
  { key: "jito.enabled", type: "true | false", note: "Legacy; migrated into tip.enabled" },
  { key: "jito.tip", type: "number", note: "Legacy tip SOL; migrated into tip.sol" },
];
const WIZARD_FIELD_GUIDANCE = {
  rpcUrl: {
    helper: "Use your SolanaTracker RPC URL. advancedTx=true is appended automatically.",
    recommended: "Your dedicated SolanaTracker endpoint",
    defaultValue: DEFAULT_CONFIG.rpcUrl,
  },
  raptorBaseUrl: {
    helper: "Hosted Raptor swap API base URL (no trailing slash required).",
    recommended: DEFAULT_CONFIG.raptorBaseUrl,
    defaultValue: DEFAULT_CONFIG.raptorBaseUrl,
  },
  slippage: {
    helper: "Max swap slippage percent. Use auto to let Raptor choose dynamically.",
    recommended: DEFAULT_CONFIG.slippage,
    defaultValue: DEFAULT_CONFIG.slippage,
  },
  priorityFee: {
    helper:
      "Use auto + priorityFeeLevel for Raptor levels, or set microlamports as a number.",
    recommended: `${DEFAULT_CONFIG.priorityFee} + ${DEFAULT_CONFIG.priorityFeeLevel}`,
    defaultValue: DEFAULT_CONFIG.priorityFee,
  },
  priorityFeeLevel: {
    helper: "Used when priorityFee is auto. Raptor levels: min, low, medium, high, veryHigh, turbo, unsafeMax.",
    recommended: DEFAULT_CONFIG.priorityFeeLevel,
    defaultValue: DEFAULT_CONFIG.priorityFeeLevel,
  },
  txVersion: {
    helper: "v0 supports address lookup tables. legacy is only for compatibility edge cases.",
    recommended: DEFAULT_CONFIG.txVersion,
    defaultValue: DEFAULT_CONFIG.txVersion,
  },
  showQuoteDetails: {
    helper: "Print full quote payload after swaps. Enable only when debugging swap math.",
    recommended: DEFAULT_CONFIG.showQuoteDetails,
    defaultValue: DEFAULT_CONFIG.showQuoteDetails,
  },
  DEBUG_MODE: {
    helper: "Verbose network logging. Useful for diagnostics, noisy for regular trading.",
    recommended: DEFAULT_CONFIG.DEBUG_MODE,
    defaultValue: DEFAULT_CONFIG.DEBUG_MODE,
  },
  notificationsEnabled: {
    helper: "macOS desktop notifications for trade and setup events.",
    recommended: DEFAULT_CONFIG.notificationsEnabled,
    defaultValue: DEFAULT_CONFIG.notificationsEnabled,
  },
  tipEnabled: {
    helper: "Attach an optional SOL tip to Raptor-built swaps.",
    recommended: DEFAULT_CONFIG.tip.enabled,
    defaultValue: DEFAULT_CONFIG.tip.enabled,
  },
  tipSol: {
    helper: "Tip in SOL when tip.enabled is true (unless tip.lamports is set).",
    recommended: DEFAULT_CONFIG.tip.sol,
    defaultValue: DEFAULT_CONFIG.tip.sol,
  },
};

const askQuestion = (rl, prompt) =>
  new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));

async function askSecretQuestion(rl, prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return askQuestion(rl, prompt);
  }

  const originalWrite = rl._writeToOutput?.bind(rl);
  rl.output.write(prompt);
  rl._writeToOutput = () => {};

  try {
    const answer = await new Promise((resolve) => rl.question("", resolve));
    rl.output.write("\n");
    return String(answer).trim();
  } finally {
    if (originalWrite) {
      rl._writeToOutput = originalWrite;
    }
  }
}

function printKeychainAccessHint() {
  console.log('   Check it in Keychain Access by searching for "summonTheWarlord" and opening "wallet-private-key".');
}

const COLOR_ENABLED = process.stdout.isTTY;
const ANSI = {
  reset: "\x1b[0m",
  blue: "\x1b[34m",
  purple: "\x1b[35m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

const paint = (text, color) => (COLOR_ENABLED ? `${color}${text}${ANSI.reset}` : text);
const SENSITIVE_URL_KEY_PATTERN = /key|token|secret|auth|signature|sig|password|pwd/i;

function maskSensitiveValue(value) {
  const text = String(value ?? "");
  if (!text) {
    return text;
  }
  if (text.length <= 4) {
    return "*".repeat(text.length);
  }
  return `${"*".repeat(text.length - 4)}${text.slice(-4)}`;
}

function redactSensitiveUrl(rawUrl) {
  const urlText = String(rawUrl ?? "").trim();
  if (!urlText) {
    return urlText;
  }

  try {
    const parsed = new URL(urlText);
    if (parsed.username) {
      parsed.username = maskSensitiveValue(parsed.username);
    }
    if (parsed.password) {
      parsed.password = maskSensitiveValue(parsed.password);
    }
    for (const [key, value] of parsed.searchParams.entries()) {
      if (SENSITIVE_URL_KEY_PATTERN.test(key)) {
        parsed.searchParams.set(key, maskSensitiveValue(value));
      }
    }
    return parsed.toString();
  } catch {
    return urlText.replace(
      /([?&][^=]*(?:key|token|secret|auth|signature|sig|password|pwd)[^=]*=)([^&]+)/ig,
      (_, prefix, value) => `${prefix}${maskSensitiveValue(value)}`
    );
  }
}

function formatConfigDisplayValue(key, value) {
  if (key === "rpcUrl") {
    return redactSensitiveUrl(value);
  }
  return toDisplayValue(value);
}

function clearScreen() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1Bc");
  } else {
    console.clear();
  }
}

function renderWizardHeader() {
  console.log("⚙️  Config Wizard");
  console.log("Press Enter to keep the current value.\n");
}

function renderWizardFieldGuidance(field) {
  const guidance = WIZARD_FIELD_GUIDANCE[field];
  if (!guidance) {
    return;
  }
  console.log(`Help: ${guidance.helper}`);
  console.log(`Recommended: ${toDisplayValue(guidance.recommended)}`);
  console.log(`Default: ${toDisplayValue(guidance.defaultValue)}\n`);
}

function toDisplayValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatBox({ title, rows }) {
  const normalizedRows = rows.map(([label, value]) => [String(label), String(value)]);
  const labelWidth = Math.max(...normalizedRows.map(([label]) => label.length), 0);
  const valueWidth = Math.max(...normalizedRows.map(([, value]) => value.length), 0);
  const titleText = title ? ` ${title} ` : "";
  const innerWidth = Math.max(labelWidth + 3 + valueWidth, titleText.length);
  const totalWidth = innerWidth + 2;

  let topBorder = `┌${"─".repeat(totalWidth)}┐`;
  if (titleText) {
    const left = Math.floor((totalWidth - titleText.length) / 2);
    const right = totalWidth - titleText.length - left;
    topBorder = `┌${"─".repeat(left)}${paint(titleText, ANSI.purple)}${"─".repeat(right)}┐`;
  }

  const lines = normalizedRows.map(([label, value]) => {
    const labelText = label.padEnd(labelWidth);
    const content = `${paint(labelText, ANSI.blue)} : ${paint(value, ANSI.green)}`;
    const contentLength = labelText.length + 3 + value.length;
    const padding = " ".repeat(Math.max(0, innerWidth - contentLength));
    return `│ ${content}${padding} │`;
  });

  const bottomBorder = `└${"─".repeat(totalWidth)}┘`;
  return [topBorder, ...lines, bottomBorder].join("\n");
}

function formatPlainBox({ title, rows }) {
  const normalizedRows = rows.map(([label, value]) => [String(label), String(value)]);
  const labelWidth = Math.max(...normalizedRows.map(([label]) => label.length), 0);
  const valueWidth = Math.max(...normalizedRows.map(([, value]) => value.length), 0);
  const titleText = title ? ` ${title} ` : "";
  const innerWidth = Math.max(labelWidth + 3 + valueWidth, titleText.length);
  const totalWidth = innerWidth + 2;

  let topBorder = `┌${"─".repeat(totalWidth)}┐`;
  if (titleText) {
    const left = Math.floor((totalWidth - titleText.length) / 2);
    const right = totalWidth - titleText.length - left;
    topBorder = `┌${"─".repeat(left)}${titleText}${"─".repeat(right)}┐`;
  }

  const lines = normalizedRows.map(([label, value]) => {
    const labelText = label.padEnd(labelWidth);
    const content = `${labelText} : ${value}`;
    const contentLength = labelText.length + 3 + value.length;
    const padding = " ".repeat(Math.max(0, innerWidth - contentLength));
    return `│ ${content}${padding} │`;
  });

  const bottomBorder = `└${"─".repeat(totalWidth)}┘`;
  return [topBorder, ...lines, bottomBorder].join("\n");
}

function renderStatusBox({ title, rows, tone }) {
  const box = formatPlainBox({ title, rows });
  const colored = box
    .split("\n")
    .map((line) => paint(line, tone))
    .join("\n");
  console.log(colored);
}

function renderConfigSummary(cfg, configPath, title = "CONFIG") {
  const tipEnabled = cfg.tip?.enabled ? "true" : "false";
  const tipSol = cfg.tip?.enabled ? cfg.tip.sol : "-";
  const rows = [
    ["Config path", configPath],
    ["RPC URL", formatConfigDisplayValue("rpcUrl", cfg.rpcUrl)],
    ["Raptor URL", cfg.raptorBaseUrl],
    ["Slippage", cfg.slippage],
    ["Priority fee", cfg.priorityFee],
    ["Priority level", cfg.priorityFeeLevel],
    ["Tx version", cfg.txVersion],
    ["Wrap/unwrap SOL", cfg.wrapUnwrapSol],
    ["DEX allowlist", cfg.dexes || "-"],
    ["Max hops", cfg.maxHops ?? "-"],
    ["Direct routes only", cfg.onlyDirectRoutes],
    ["Show quote", cfg.showQuoteDetails],
    ["Debug mode", cfg.DEBUG_MODE],
    ["Notifications", cfg.notificationsEnabled],
    ["Tip enabled", tipEnabled],
    ["Tip (SOL)", tipSol],
  ];
  console.log(formatBox({ title, rows }));
}

async function promptSelect(rl, label, options, { current, required = false } = {}) {
  const menu = options.map((opt, index) => `  ${index + 1}) ${opt}`).join("\n");
  while (true) {
    console.log(`\n${label}`);
    console.log(menu);
    const suffix = current ? ` [${current}]` : "";
    const answer = await askQuestion(rl, `Select${suffix}: `);
    if (!answer) {
      if (required) {
        console.log("⚠️  Selection required.");
        continue;
      }
      return current;
    }
    const normalized = answer.trim();
    const index = Number(normalized);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return options[index - 1];
    }
    const match = options.find((opt) => opt.toLowerCase() === normalized.toLowerCase());
    if (match) return match;
    console.log("⚠️  Invalid selection. Choose a number or value from the list.");
  }
}

async function promptNormalized(rl, label, key, { current, required = false } = {}) {
  while (true) {
    const suffix = current !== undefined ? ` [${formatConfigDisplayValue(key, current)}]` : "";
    const answer = await askQuestion(rl, `${label}${suffix}: `);
    if (!answer) {
      if (required) {
        console.log("⚠️  Value required.");
        continue;
      }
      return current;
    }
    try {
      return normalizeConfigValue(key, parseConfigValue(answer), { strict: true });
    } catch (err) {
      console.log(`⚠️  ${err.message}`);
    }
  }
}

async function promptNumber(rl, label, { current, required = false } = {}) {
  while (true) {
    const suffix = current !== undefined ? ` [${toDisplayValue(current)}]` : "";
    const answer = await askQuestion(rl, `${label}${suffix}: `);
    if (!answer) {
      if (required) {
        console.log("⚠️  Value required.");
        continue;
      }
      return current;
    }
    const num = Number(answer);
    if (Number.isFinite(num) && num >= 0) {
      return num;
    }
    console.log("⚠️  Invalid number. Use a non-negative value.");
  }
}

async function runConfigWizard({ cfg, rl }) {
  const nextCfg = {
    ...cfg,
    jito: { ...DEFAULT_CONFIG.jito, ...(cfg.jito || {}) },
    tip: { ...DEFAULT_CONFIG.tip, ...(cfg.tip || {}) },
  };

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("rpcUrl");
  nextCfg.rpcUrl = await promptNormalized(rl, "RPC URL", "rpcUrl", { current: nextCfg.rpcUrl });

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("raptorBaseUrl");
  nextCfg.raptorBaseUrl = await promptNormalized(rl, "Raptor base URL", "raptorBaseUrl", {
    current: nextCfg.raptorBaseUrl,
  });

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("slippage");
  nextCfg.slippage = await promptNormalized(rl, "Max slippage (number or \"auto\")", "slippage", {
    current: nextCfg.slippage,
  });

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("priorityFee");
  nextCfg.priorityFee = await promptNormalized(rl, "Priority fee (auto, level, or microlamports)", "priorityFee", {
    current: nextCfg.priorityFee,
  });

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("priorityFeeLevel");
  nextCfg.priorityFeeLevel = await promptSelect(
    rl,
    "Priority fee level (used when priorityFee is auto)",
    PRIORITY_FEE_LEVELS,
    {
      current: nextCfg.priorityFeeLevel,
      required: true,
    }
  );

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("txVersion");
  nextCfg.txVersion = await promptSelect(rl, "Transaction version", TX_VERSIONS, {
    current: nextCfg.txVersion,
  });

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("showQuoteDetails");
  const showQuoteDetails = await promptSelect(rl, "Show quote details", ["true", "false"], {
    current: nextCfg.showQuoteDetails ? "true" : "false",
  });
  nextCfg.showQuoteDetails = showQuoteDetails === "true";

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("DEBUG_MODE");
  const debugMode = await promptSelect(rl, "Enable debug mode", ["true", "false"], {
    current: nextCfg.DEBUG_MODE ? "true" : "false",
  });
  nextCfg.DEBUG_MODE = debugMode === "true";

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("notificationsEnabled");
  const notificationsEnabled = await promptSelect(rl, "Enable notifications", ["true", "false"], {
    current: nextCfg.notificationsEnabled ? "true" : "false",
  });
  nextCfg.notificationsEnabled = notificationsEnabled === "true";

  clearScreen();
  renderWizardHeader();
  renderWizardFieldGuidance("tipEnabled");
  const tipEnabled = await promptSelect(rl, "Enable SOL tips on swaps", ["true", "false"], {
    current: nextCfg.tip.enabled ? "true" : "false",
  });
  nextCfg.tip.enabled = tipEnabled === "true";
  if (nextCfg.tip.enabled) {
    clearScreen();
    renderWizardHeader();
    renderWizardFieldGuidance("tipSol");
    nextCfg.tip.sol = await promptNumber(rl, "Tip amount (SOL)", {
      current: nextCfg.tip.sol,
      required: true,
    });
  }

  return nextCfg;
}

let tradeModulePromise;
const getTradeModule = async () => {
  if (!tradeModulePromise) {
    tradeModulePromise = import("./lib/trades.js");
  }
  return tradeModulePromise;
};

function getTradeCommandExample(type, mint = MINT_EXAMPLE) {
  const amountExample = type === "buy" ? "0.01" : "auto";
  return `summon ${type} ${mint} ${amountExample}`;
}

function renderTradeValidationErrors(type, validation) {
  console.error(`Usage: summon ${type} [mint] [amount]`);
  for (const issue of validation.issues) {
    console.error(`⚠️  ${issue.message}`);
    if (issue.field === "mint") {
      console.error(`    Example: ${getTradeCommandExample(type)}`);
      continue;
    }
    if (issue.field === "amount") {
      const amountExamples = getAmountExamples(type).join(", ");
      const mintForExample = validation.mint || MINT_EXAMPLE;
      console.error(`    Amount examples: ${amountExamples}`);
      console.error(`    Example: ${getTradeCommandExample(type, mintForExample)}`);
    }
  }
}

async function resolveTradeInput(type, mintArg, amountArg) {
  let mint = mintArg;
  let amount = amountArg;
  let validation = validateTradeInput({ type, mint, amount });
  if (validation.ok) {
    return validation;
  }

  const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!canPrompt) {
    renderTradeValidationErrors(type, validation);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (!validation.ok) {
      const mintIssue = validation.issues.find((issue) => issue.field === "mint");
      if (mintIssue) {
        console.log(`⚠️  ${mintIssue.message}`);
        console.log(`   Example mint: ${MINT_EXAMPLE}`);
        mint = await askQuestion(rl, "Mint address: ");
      }

      const amountIssue = validation.issues.find((issue) => issue.field === "amount");
      if (amountIssue) {
        console.log(`⚠️  ${amountIssue.message}`);
        console.log(`   Amount examples: ${getAmountExamples(type).join(", ")}`);
        amount = await askQuestion(rl, "Amount: ");
      }

      validation = validateTradeInput({ type, mint, amount });
    }
  } finally {
    rl.close();
  }

  return validation;
}

async function executeTrade(type, mintArg, amountArg) {
  const cfg = await loadConfig();
  const validated = await resolveTradeInput(type, mintArg, amountArg);
  const mint = validated.mint;
  const amountParam = validated.amount;

  try {
    const mintDisplay = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
    const amountDisplay = String(amountParam);
    const baseRows = [
      ["Action", type === "buy" ? "Buy" : "Sell"],
      ["Mint", mintDisplay],
      ["Amount", amountDisplay],
    ];
    clearScreen();
    renderStatusBox({
      title: "PENDING",
      tone: ANSI.yellow,
      rows: [
        ...baseRows,
        ["TXID", "-"],
        ["Explorer", "-"],
        ["Info", "Submitting swap..."],
      ],
    });

    if (type === "buy") {
      if (amountParam === "auto") {
        console.error("⚠️  Buying with 'auto' isn’t supported. Use a number or '<percent>%'.");
        process.exit(1);
      }

      const { buyToken } = await getTradeModule();
      const result = await buyToken(mint, amountParam, { cfg });
      clearScreen();
      const info = `Received ${result.tokensReceivedDecimal} tokens | Fees ${result.totalFees} | Impact ${result.priceImpact}`;
      const buyRows = [
        ...baseRows,
        ["TXID", result.txid],
        ["Explorer", `https://orbmarkets.io/tx/${result.txid}`],
        ["Info", info],
        ["Verification", result.verificationStatus],
      ];
      renderStatusBox({ title: "SUCCESS", rows: buyRows, tone: ANSI.green });
      if (cfg.showQuoteDetails) {
        console.log(`   • Quote Details     : ${JSON.stringify(result.quote, null, 2)}`);
      }
    } else if (type === "sell") {
      const { sellToken } = await getTradeModule();
      const result = await sellToken(mint, amountParam, { cfg });
      clearScreen();
      const info = `Received ${result.solReceivedDecimal} SOL | Fees ${result.totalFees} | Impact ${result.priceImpact}`;
      const sellRows = [
        ...baseRows,
        ["TXID", result.txid],
        ["Explorer", `https://orbmarkets.io/tx/${result.txid}`],
        ["Info", info],
        ["Verification", result.verificationStatus],
      ];
      renderStatusBox({ title: "SUCCESS", rows: sellRows, tone: ANSI.green });
      if (cfg.showQuoteDetails) {
        console.log(`   • Quote Details      : ${JSON.stringify(result.quote, null, 2)}`);
      }
    }
    process.exit(0);
  } catch (err) {
    clearScreen();
    const errorMessage = err?.message || "Unknown error";
    const txidMatch = errorMessage.match(/[1-9A-HJ-NP-Za-km-z]{32,}/);
    const txid = txidMatch ? txidMatch[0] : "-";
    const explorer = txidMatch ? `https://orbmarkets.io/tx/${txid}` : "-";
    const mintDisplay = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
    const amountDisplay = String(amountParam);
    renderStatusBox({
      title: "FAILED",
      tone: ANSI.red,
      rows: [
        ["Action", type === "buy" ? "Buy" : "Sell"],
        ["Mint", mintDisplay],
        ["Amount", amountDisplay],
        ["TXID", txid],
        ["Explorer", explorer],
        ["Error", errorMessage],
      ],
    });
    process.exit(1);
  }
}

// CONFIG subcommands
const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("view")
  .description("Show current config")
  .action(async () => {
    const configPath = getConfigPath();
    const cfg = await loadConfig();
    console.log(`Config file: ${configPath}\n`);
    renderConfigSummary(cfg, configPath);
  });

configCmd
  .command("edit")
  .description("Edit config in your $EDITOR")
  .action(async () => {
    await editConfig();
  });

configCmd
  .command("set <key> <value>")
  .description("Set a single config key")
  .action(async (key, value) => {
    const configPath = getConfigPath();
    const cfg = await loadConfig();
    const parsedValue = parseConfigValue(value);
    if (!CONFIG_KEY_SET.has(key)) {
      console.error(`⚠️  Unknown config key: ${key}`);
      console.error("Run `summon config list` to see valid keys.");
      process.exit(1);
    }
    try {
      if (key.startsWith("jito.")) {
        const field = key.split(".")[1];
        const nextJito = { ...(cfg.jito || DEFAULT_CONFIG.jito), [field]: parsedValue };
        cfg.jito = normalizeConfigValue("jito", nextJito, { strict: true });
      } else if (key.startsWith("tip.")) {
        const field = key.split(".")[1];
        const nextTip = { ...(cfg.tip || DEFAULT_CONFIG.tip), [field]: parsedValue };
        cfg.tip = normalizeConfigValue("tip", nextTip, { strict: true });
      } else {
        const normalizedValue = normalizeConfigValue(key, parsedValue, { strict: true });
        cfg[key] = normalizedValue;
        if (key === "priorityFee" && normalizedValue === "auto") {
          console.log(
            `ℹ️  priorityFeeLevel is required when priorityFee is auto. Current level: ${cfg.priorityFeeLevel}`
          );
        }
      }
    } catch (err) {
      console.error(`⚠️  ${err.message}`);
      process.exit(1);
    }
    await saveConfig(cfg);
    let displayValue;
    if (key.startsWith("jito.")) {
      displayValue = toDisplayValue(cfg.jito?.[key.split(".")[1]]);
    } else if (key.startsWith("tip.")) {
      displayValue = toDisplayValue(cfg.tip?.[key.split(".")[1]]);
    } else {
      displayValue = formatConfigDisplayValue(key, cfg[key]);
    }
    console.log(`✅  Updated ${key} → ${displayValue} in ${configPath}`);
    renderConfigSummary(cfg, configPath);
  });

configCmd
  .command("list")
  .description("List available config keys and types")
  .action(() => {
    console.log("Available config keys:");
    for (const entry of CONFIG_HELP) {
      console.log(`  • ${entry.key} (${entry.type}) — ${entry.note}`);
    }
  });

configCmd
  .command("wizard")
  .description("Interactive config editor with type validation")
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const cfg = await loadConfig();
    const updated = await runConfigWizard({ cfg, rl });
    await saveConfig(updated);
    rl.close();
    const configPath = getConfigPath();
    console.log("✅ Config updated.");
    renderConfigSummary(updated, configPath);
  });

// SETUP command – interactive setup wizard
program
  .command("setup")
  .description("Run interactive setup for config and keychain")
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const configPath = getConfigPath();
    const cfg = await loadConfig();

    console.log("⚙️  Summon CLI Setup\n");
    const updated = await runConfigWizard({ cfg, rl });
    await saveConfig(updated);
    console.log(`✅ Config saved to ${configPath}`);

    // Private key
    try {
      if (await hasPrivateKey()) {
        const updateKey = await askQuestion(
          rl,
          "🔓 Private key already stored in Keychain. Would you like to replace it? (y/N): "
        );
        if (updateKey.toLowerCase() === "y") {
          const privKey = await askSecretQuestion(rl, "Paste your new private key: ");
          await storePrivateKey(privKey);
          console.log("🔐 Private key updated.");
          printKeychainAccessHint();
        } else {
          console.log("✅ Keeping existing private key.");
        }
      } else {
        const storeKey = await askQuestion(
          rl,
          "Would you like to store your private key in the macOS Keychain now? (y/N): "
        );
        if (storeKey.toLowerCase() === "y") {
          const privKey = await askSecretQuestion(rl, "Paste your private key: ");
          await storePrivateKey(privKey);
          console.log("🔐 Private key stored securely.");
          printKeychainAccessHint();
        } else {
          console.log("⚠️ No private key stored. You can add one later with `summon keychain store`.");
        }
      }
    } catch (e) {
      console.error("❌ Keychain error:", e.message);
    }

    // Raptor API key (required for swaps)
    try {
      if (await hasRaptorApiKey()) {
        const updateKey = await askQuestion(
          rl,
          "🔑 Raptor API key already stored. Replace it? (y/N): "
        );
        if (updateKey.toLowerCase() === "y") {
          const apiKey = await askSecretQuestion(rl, "Paste your Raptor API key: ");
          await storeRaptorApiKey(apiKey);
        } else {
          console.log("✅ Keeping existing Raptor API key.");
        }
      } else {
        const storeKey = await askQuestion(
          rl,
          "Store Raptor API key now? Required for swaps. (Y/n): "
        );
        if (storeKey.toLowerCase() !== "n") {
          const apiKey = await askSecretQuestion(rl, "Paste your Raptor API key: ");
          await storeRaptorApiKey(apiKey);
        } else {
          console.log("⚠️ No Raptor API key stored. Add one with `summon keychain store-api-key`.");
        }
      }
    } catch (e) {
      console.error("❌ Raptor API key Keychain error:", e.message);
    }

    rl.close();
    console.log("🧠 Setup complete.");

    // Test macOS notifications so users can allow permissions now
    if (updated.notificationsEnabled !== false) {
      try {
        notify({
          title: "summonTheWarlord",
          subtitle: "Setup complete",
          message: "If you see this, notifications are enabled.",
          sound: "Ping",
        });
        console.log("🔔 Test notification sent. If you see it, notifications are enabled.");
      } catch {
        console.warn("⚠️ Unable to send test notification. You may need to enable notifications for your terminal.");
      }
    } else {
      console.log("🔕 Notifications are disabled in config.");
    }
  });

// KEYCHAIN subcommands
const keychainCmd = program.command("keychain").description("Manage secrets in macOS Keychain");

keychainCmd
  .command("store")
  .description("Store private key securely in macOS Keychain")
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const input = await askSecretQuestion(rl, "Paste your wallet private key: ");
      rl.close();
      await storePrivateKey(input);
      printKeychainAccessHint();
    } catch (err) {
      rl.close();
      console.error("❌ Failed to store key:", err.message);
      process.exitCode = 1;
    }
  });

keychainCmd
  .command("store-api-key")
  .description("Store Raptor API key (x-api-key) in macOS Keychain")
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const input = await askSecretQuestion(rl, "Paste your Raptor API key: ");
      rl.close();
      await storeRaptorApiKey(input);
    } catch (err) {
      rl.close();
      console.error("❌ Failed to store Raptor API key:", err.message);
      process.exitCode = 1;
    }
  });

keychainCmd
  .command("unlock")
  .description("Test retrieval of private key from macOS Keychain")
  .action(async () => {
    try {
      const key = await getPrivateKey();
      if (key) console.log("🔓 Private key retrieved successfully.");
    } catch (err) {
      console.error("❌ Failed to retrieve key:", err.message);
    }
  });

keychainCmd
  .command("unlock-api-key")
  .description("Test retrieval of Raptor API key from macOS Keychain")
  .action(async () => {
    try {
      const key = await getRaptorApiKey();
      if (key) console.log("🔓 Raptor API key retrieved successfully.");
    } catch (err) {
      console.error("❌ Failed to retrieve Raptor API key:", err.message);
    }
  });

keychainCmd
  .command("delete")
  .description("Delete the private key from macOS Keychain")
  .action(async () => {
    await deletePrivateKey();
  });

keychainCmd
  .command("delete-api-key")
  .description("Delete the Raptor API key from macOS Keychain")
  .action(async () => {
    await deleteRaptorApiKey();
  });

program
  .command("buy [mint] [amount]")
  .description("Buy a token with SOL (prompts for missing values in interactive TTY)")
  .action(async (mint, amount) => {
    await executeTrade("buy", mint, amount);
  });

program
  .command("sell [mint] [amount]")
  .description("Sell a token for SOL (prompts for missing values in interactive TTY)")
  .action(async (mint, amount) => {
    await executeTrade("sell", mint, amount);
  });

// Trade command with options for buy and sell (deprecated)
program
  .command("trade <mint>", { hidden: true })
  .description("DEPRECATED: Trade a specific token")
  .option("-b, --buy <amount>", "Spend <amount> SOL (number or '<percent>%') to buy token")
  .option("-s, --sell <amount>", "Sell <amount> tokens (number, 'auto', or '<percent>%')")
  .action(async (mint, options) => {
    console.log("⚠️  'summon trade' is deprecated. Use 'summon buy' or 'summon sell' instead.");
    if (options.buy) {
      await executeTrade("buy", mint, options.buy);
    } else if (options.sell) {
      await executeTrade("sell", mint, options.sell);
    } else {
      console.log("⚠️  Please specify --buy <amount> or --sell <amount>");
      process.exit(1);
    }
  });

program
  .command("wallet")
  .alias("w")
  .description("Open your wallet in the browser via SolanaTracker.io")
  .action(async () => {
    try {
      const [{ loadWalletSigner }, { default: open }] = await Promise.all([
        import("./lib/wallet.js"),
        import("open"),
      ]);
      const signer = await loadWalletSigner();
      const pubkey = signer.address;
      const url = `https://www.solanatracker.io/wallet/${pubkey}`;
      console.log(`🌐 Opening wallet in browser: ${url}`);
      await open(url);
    } catch (err) {
      console.error("❌ Failed to load key from Keychain:", err.message);
    }
  });

function extractSuggestedCommands(results) {
  const commands = new Set();
  for (const result of results) {
    if (result.status !== "fail" || !result.hint) {
      continue;
    }
    const matches = [...result.hint.matchAll(/`([^`]+)`/g)];
    for (const match of matches) {
      const candidate = match[1].trim();
      if (candidate.startsWith("summon ")) {
        commands.add(candidate);
      }
    }
  }
  return [...commands];
}

// DOCTOR command
program
  .command("doctor")
  .description("Run environment and connectivity checks")
  .option("-v, --verbose", "Show verbose output")
  .action(async (options) => {
    const results = await runDoctor({ verbose: Boolean(options.verbose) });
    for (const result of results) {
      const icon = result.status === "ok" ? "✅" : result.status === "skip" ? "⚠️" : "❌";
      console.log(`${icon} ${result.name}: ${result.message}`);
      if (result.status === "fail" && result.hint) {
        console.log(`   • Hint: ${result.hint}`);
      }
      if (options.verbose && result.details) {
        console.log(`   • ${result.details}`);
      }
    }
    const failures = results.filter((item) => item.status === "fail");
    const suggestedCommands = extractSuggestedCommands(results);

    console.log("");
    console.log(
      `Doctor summary: ${failures.length} failure${failures.length === 1 ? "" : "s"} out of ${results.length} checks.`
    );
    if (suggestedCommands.length) {
      console.log("Suggested commands:");
      for (const command of suggestedCommands) {
        console.log(`  • ${command}`);
      }
    }

    process.exit(failures.length ? 1 : 0);
  });

// MANUAL command
program
  .command("man")
  .alias("m")
  .description("Display usage and help information")
  .action(() => {
    console.log(`
📖 Summon CLI Manual

FIRST TIME QUICKSTART:
  1) summon setup
     Saves config + wallet key + Raptor API key in Keychain.
  2) summon config wizard
     Review RPC, Raptor URL, fees, slippage, tips, notifications.
  3) summon doctor
     Confirms RPC + Raptor swap API are healthy.
  4) summon buy <mint> 0.01
     Start small while you learn.

TERMS:
  • Mint = token address (base58). Copy it from a Solana explorer or DEX listing.
  • Amounts:
      - Buy uses SOL amount (e.g. 0.1)
      - Sell uses token amount, percent (50%), or auto for full balance

USAGE:
  summon setup
      Run initial setup wizard (RPC, Raptor URL, fees, tips, Keychain secrets)

  summon config view
      View current configuration

  summon config edit
      Edit config in your $EDITOR

  summon config set <key> <value>
      Set a single config key

  summon config wizard
      Interactive config editor with type validation

  summon config list
      List available config keys and types

  summon keychain store
      Store your private key in the macOS Keychain (recommended)
        • Paste either a base58-encoded string OR a JSON array like [12, 34, ...]

  summon keychain store-api-key
      Store Raptor API key (sent as x-api-key header)

  summon keychain unlock
      Retrieve and verify your stored wallet key

  summon keychain unlock-api-key
      Verify Raptor API key is readable

  summon keychain delete
      Delete the private key from macOS Keychain

  summon keychain delete-api-key
      Delete the Raptor API key from macOS Keychain

  summon buy [mint] [amount]
  summon sell [mint] [amount]
      Buy or sell a token. Amount formats:
        • Fixed amount (e.g. 0.5 or 100)
        • Percent of holdings (e.g. 50%)
        • "auto" (sell only — sells your full balance)
      In an interactive terminal, missing/invalid mint or amount will be prompted.

  summon wallet
      Open your wallet on SolanaTracker.io

  summon doctor
      Run diagnostics for config, Keychain, RPC, swap API, and notifications

  summon man
      Display this manual

NOTES:
  • Swaps use Solana Tracker's Raptor API (quote → sign with Kit → send).
      Default base URL: https://raptor-beta.solanatracker.io (override with raptorBaseUrl).
      Raptor API key is required (Keychain: summon keychain store-api-key).
  • RPC still comes from SolanaTracker for balances/decimals/doctor.
      Signup: https://www.solanatracker.io/solana-rpc
  • Use summon buy or summon sell for trades
  • Buying with "auto" is NOT supported — use a number or percent
  • Secrets (wallet + Raptor API key) live in macOS Keychain only
  • Notifications are optional. Toggle notificationsEnabled in config if you want silence.
  • Swaps show Pending → Success/Failed panes. If Verification is pending, open:
      https://orbmarkets.io/tx/<txid>
  • Quote details can be toggled in config or during setup
  • Always confirm transactions via returned TXID and fees

Enjoy the chaos. 🪖
    `);
  });

// If no subcommand provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);
