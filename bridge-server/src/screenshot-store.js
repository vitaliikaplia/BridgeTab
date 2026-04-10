const fs = require("fs");
const path = require("path");

class ScreenshotStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  savePng(base64Data, prefix = "capture") {
    const fileName = `${prefix}-${Date.now()}.png`;
    const filePath = path.join(this.baseDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
    return filePath;
  }
}

module.exports = {
  ScreenshotStore
};

