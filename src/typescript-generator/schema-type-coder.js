import { Coder } from "./coder.js";

export class SchemaTypeCoder extends Coder {
  name() {
    return String(this.requirement.data.$ref.split("/").at(-1));
  }

  objectSchema(script) {
    return `{${Object.keys(this.requirement.data.properties ?? {})
      .map((name) => {
        const property = this.requirement.select(`properties/${name}`);

        return `${name}: ${new SchemaTypeCoder(property).write(script)}`;
      })
      .join(",")}}`;
  }

  arraySchema(script) {
    return `Array<${new SchemaTypeCoder(this.requirement.select("items")).write(
      script
    )}>`;
  }

  write(script) {
    if (this.requirement.isReference) {
      return script.importType(
        this,
        `components/${this.requirement.data.$ref.split("/").at(-1)}.ts`
      );
    }

    const { type } = this.requirement.data;

    if (type === "object") {
      return this.objectSchema(script);
    }

    if (type === "array") {
      return this.arraySchema(script);
    }

    if (type === "integer") {
      return "number";
    }

    return type;
  }
}
