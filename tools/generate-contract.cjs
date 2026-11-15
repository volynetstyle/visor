"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const model = JSON.parse(fs.readFileSync(path.join(root, "contract/model.json"), "utf8"));
const wire = JSON.parse(fs.readFileSync(path.join(root, "contract/protocol.json"), "utf8"));
const schema = {version:wire.version, limits:wire.limits, maturity:model.maturity, lifecycle:model.lifecycle,
  invariants:model.invariants, enums:model.enums, records:model.records,
  methods:Object.fromEntries(Object.entries(model.operations).map(([name,def]) => [name, wire.notifications.includes(name) ? {...def,notification:true} : def]))};
const header = "// Generated from contract/model.json + contract/protocol.json. Do not edit.\n";
const type = (name, language) => {
  const nullable = name.endsWith("?");
  const base = nullable ? name.slice(0, -1) : name;
  const mapped = ({ ts: { number: "number", string: "string", boolean: "boolean" },
    kt: { number: "Double", string: "String", boolean: "Boolean" },
    swift: { number: "Double", string: "String", boolean: "Bool" } })[language][base] || base;
  return mapped + (nullable ? language === "ts" ? " | null" : "?" : "");
};
let ts = header + "export type Unsubscribe = () => void;\n";
ts += "export type ModelMaturity = " + JSON.stringify(model.maturity) + ";\n";
let kt = header + "package io.volynetstyle.visor.contract\n\n";
kt += "object Model { const val MATURITY = " + JSON.stringify(model.maturity) + "; val INVARIANTS = listOf(" + model.invariants.map(JSON.stringify).join(", ") + ") }\n";
kt += "enum class VisorMethod(val wire: String) { " + Object.keys(schema.methods)
  .map(name => name.replaceAll(".", "_").toUpperCase() + "(" + JSON.stringify(name) + ")").join(", ") + " }\n";
let swift = header + "import Foundation\n\n";
swift += "public enum VisorModel { public static let maturity = " + JSON.stringify(model.maturity) + "; public static let invariants = [" + model.invariants.map(JSON.stringify).join(", ") + "] }\n";
swift += "public enum VisorProtocol { public static let version = " + schema.version +
  "; public static let maxPending = " + schema.limits.maxPending + " }\n";
swift += "public enum VisorMethod: String, Codable {\n" +
  Object.keys(schema.methods).map(name => "    case " + name.replaceAll(".", "_") + " = " + JSON.stringify(name)).join("\n") + "\n}\n";
for (const [name, values] of Object.entries(schema.enums)) {
  ts += "export type " + name + " = " + values.map(JSON.stringify).join(" | ") + ";\n";
  kt += "enum class " + name + "(val wire: String) { " + values.map(v => v.toUpperCase() + "(" + JSON.stringify(v) + ")").join(", ") + " }\n";
  swift += "public enum " + name + ": String, Codable {\n" + values.map(v => "    case " + v.toLowerCase() + " = " + JSON.stringify(v)).join("\n") + "\n}\n";
}
for (const [name, fields] of Object.entries(schema.records)) {
  ts += "export interface " + name + " { " + Object.entries(fields).map(([k,v]) => "readonly " + k + ": " + type(v, "ts")).join("; ") + " }\n";
  if (Object.keys(fields).length) {
    kt += "data class " + name + "(\n" + Object.entries(fields).map(([k,v]) => "    val " + k + ": " + type(v, "kt")).join(",\n") + "\n)\n";
  } else kt += "object " + name + "\n";
  swift += "public struct " + name + ": Codable {\n" + Object.entries(fields).map(([k,v]) => "    public let " + k + ": " + type(v, "swift")).join("\n") + "\n}\n";
}
ts += "export interface VisorBackend {\n";
for (const port of ["camera", "system"]) {
  ts += "  readonly " + port + ": {\n";
  for (const [method, definition] of Object.entries(schema.methods)) {
    if (!method.startsWith(port + ".")) continue;
    const name = method.split(".")[1];
    ts += "    " + name + "(params" + (definition.params === "Empty" ? "?" : "") + ": " + definition.params + "): " +
      (definition.notification ? "void" : "Promise<" + definition.result + ">") + ";\n";
  }
  if (port === "camera") ts += "    onState(callback: (state: CameraState) => void): Unsubscribe;\n    onCapture(callback: (event: CaptureEvent) => void): Unsubscribe;\n";
  ts += "  };\n";
}
ts += "  dispose(): void;\n}\n";
kt += "object Protocol {\n    const val VERSION = " + schema.version + "\n    const val MAX_PENDING = " + schema.limits.maxPending +
  "\n    const val MAX_MESSAGE_BYTES = " + schema.limits.maxMessageBytes + "\n    val METHODS = setOf(" + Object.keys(schema.methods).map(JSON.stringify).join(", ") + ")\n" +
  "    val PARAM_FIELDS = mapOf(\n" + Object.entries(schema.methods).map(([method, definition]) =>
    "        " + JSON.stringify(method) + " to setOf<String>(" + Object.keys(schema.records[definition.params]).map(JSON.stringify).join(", ") + ")").join(",\n") + "\n    )\n}\n";
const outputs = {
  "contract/generated/types.d.ts": ts,
  "contract/generated/VisorContract.swift": swift,
  "contract/generated/VisorContract.kt": kt,
  "contract/generated/contract.js": header + 'window.VisorContract = Object.freeze(' + JSON.stringify(schema) + ');\n'
};
for (const [file, contents] of Object.entries(outputs)) {
  const full = path.join(root, file);
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(full) || fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n") !== contents) {
      throw Error("Contract binding is stale: " + file + ". Run node tools/generate-contract.cjs");
    }
  } else {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
}
