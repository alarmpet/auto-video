export function parseCli(argv, definitions) {
  if (argv.length === 0) {
    const err = new Error("No command provided");
    err.code = "invalid_cli_argument";
    err.details = { message: "No command provided" };
    throw err;
  }

  const command = argv[0];
  const def = definitions[command];
  if (!def) {
    const err = new Error(`Unknown command: ${command}`);
    err.code = "invalid_cli_argument";
    err.details = { message: `Unknown command: ${command}` };
    throw err;
  }

  const parsed = {};
  const seenFlags = new Set();

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      const err = new Error(`Unexpected positional argument: ${arg}`);
      err.code = "invalid_cli_argument";
      err.details = { message: `Unexpected positional argument: ${arg}` };
      throw err;
    }

    const flagName = arg.slice(2);
    if (!Object.hasOwn(def, flagName)) {
      const err = new Error(`Unknown flag: ${arg}`);
      err.code = "invalid_cli_argument";
      err.details = { message: `Unknown flag: ${arg}` };
      throw err;
    }

    if (seenFlags.has(flagName)) {
      const err = new Error(`Duplicate flag: ${arg}`);
      err.code = "invalid_cli_argument";
      err.details = { message: `Duplicate flag: ${arg}` };
      throw err;
    }
    seenFlags.add(flagName);

    const flagDef = def[flagName];
    if (flagDef.type === "boolean") {
      parsed[flagName] = true;
    } else {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        const err = new Error(`Missing value for flag: ${arg}`);
        err.code = "invalid_cli_argument";
        err.details = { message: `Missing value for flag: ${arg}` };
        throw err;
      }
      i++; // consume value

      if (flagDef.type === "integer") {
        const num = Number(val);
        if (!Number.isInteger(num)) {
          const err = new Error(`Value for flag ${arg} must be an integer`);
          err.code = "invalid_cli_argument";
          err.details = { message: `Value for flag ${arg} must be an integer` };
          throw err;
        }
        parsed[flagName] = num;
      } else if (flagDef.type === "string") {
        if (flagDef.enum && !flagDef.enum.includes(val)) {
          const err = new Error(`Invalid value for flag ${arg}: ${val}`);
          err.code = "invalid_cli_argument";
          err.details = { message: `Invalid value for flag ${arg}: ${val}` };
          throw err;
        }
        parsed[flagName] = val;
      }
    }
  }

  for (const [name, flagDef] of Object.entries(def)) {
    if (flagDef.required && parsed[name] === undefined) {
      const err = new Error(`Missing required flag: --${name}`);
      err.code = "invalid_cli_argument";
      err.details = { message: `Missing required flag: --${name}` };
      throw err;
    }
  }

  return {
    command,
    args: parsed
  };
}
