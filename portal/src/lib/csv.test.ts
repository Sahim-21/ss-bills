import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(toCsv([["a,b", 'say "hi"', "line\nbreak", 5, null]])).toBe('"a,b","say ""hi""","line\nbreak",5,');
  });

  it("neutralises spreadsheet formulas in text", () => {
    expect(toCsv([['=HYPERLINK("x")', "+1", "-2", "@cmd", "ok"]])).toBe(`"'=HYPERLINK(""x"")",'+1,'-2,'@cmd,ok`);
  });

  it("leaves real negative numbers alone", () => {
    expect(toCsv([[-5, "text"]])).toBe("-5,text");
  });
});
