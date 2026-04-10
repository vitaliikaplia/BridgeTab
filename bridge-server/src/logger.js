const fs = require("fs");

class Logger {
  constructor(logPath, limit = 300) {
    this.logPath = logPath;
    this.limit = limit;
    this.entries = [];
  }

  add(entry) {
    const record = {
      timestamp: new Date().toISOString(),
      ...entry
    };

    this.entries.unshift(record);
    this.entries = this.entries.slice(0, this.limit);
    fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  list() {
    return this.entries;
  }
}

module.exports = {
  Logger
};

