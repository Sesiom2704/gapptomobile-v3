const fs = require("fs");
const path = require("path");

const glyphPath = path.join(
  process.cwd(),
  "node_modules",
  "@expo",
  "vector-icons",
  "build",
  "vendor",
  "react-native-vector-icons",
  "glyphmaps",
  "Ionicons.json"
);

const glyphs = JSON.parse(fs.readFileSync(glyphPath, "utf8"));

const extensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const ignored = new Set(["node_modules", ".git", ".expo", "android", "ios"]);

const found = [];

function addResult(file, text, index, name, origin) {
  const line = text.substring(0, index).split(/\r?\n/).length;

  found.push({
    file: path.relative(process.cwd(), file),
    line,
    name,
    origin,
    exists: Object.prototype.hasOwnProperty.call(glyphs, name),
  });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (!extensions.has(path.extname(entry.name))) continue;

    const text = fs.readFileSync(full, "utf8");

    if (!text.includes("Ionicons")) continue;

    // 1. Ionicons con name literal
    const literalRegex =
      /<Ionicons\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/g;

    let match;

    while ((match = literalRegex.exec(text)) !== null) {
      addResult(full, text, match.index, match[1], "Ionicons literal");
    }

    // 2. Variables relacionadas con iconos
    // iconName = "wallet-outline"
    // finalQuickActionIcon = "add-circle"
    // icon: "cash-outline"
    const variableRegex =
      /\b([A-Za-z0-9_]*icon[A-Za-z0-9_]*)\s*[:=]\s*["']([a-z0-9-]+)["']/gi;

    while ((match = variableRegex.exec(text)) !== null) {
      addResult(
        full,
        text,
        match.index,
        match[2],
        `variable ${match[1]}`
      );
    }
  }
}

walk(process.cwd());

const unique = [];
const seen = new Set();

for (const item of found) {
  const key = `${item.file}:${item.line}:${item.name}`;

  if (!seen.has(key)) {
    seen.add(key);
    unique.push(item);
  }
}

const invalid = unique.filter(x => !x.exists);

console.log("");
console.log("======================================");
console.log("IONICONS NO EXISTENTES");
console.log("======================================");
console.log("");

if (invalid.length === 0) {
  console.log("NINGUNO");
} else {
  for (const item of invalid) {
    console.log(
      `${item.file}:${item.line} -> ${item.name} [${item.origin}]`
    );
  }
}

console.log("");
console.log("======================================");
console.log(`Total nombres analizados: ${unique.length}`);
console.log(`No existentes: ${invalid.length}`);
console.log("======================================");
