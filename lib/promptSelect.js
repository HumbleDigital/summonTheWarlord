const askQuestion = (rl, prompt) =>
  new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));

export async function promptSelect(rl, label, options, { current, required = false } = {}) {
  const menu = options.map((opt, index) => `  ${index + 1}) ${opt}`).join("\n");
  while (true) {
    console.log(`\n${label}`);
    console.log(menu);
    const suffix = current ? ` [${current}]` : "";
    const answer = await askQuestion(rl, `Select${suffix}: `);
    if (!answer) {
      if (current !== undefined && current !== null && current !== "") {
        return current;
      }
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
