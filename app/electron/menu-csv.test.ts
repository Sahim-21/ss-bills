import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parseCsv, parsePrice, parseFlag, readMenuCsv, decodeCsvBuffer, makeShortCode, planImport, toCsv, LIMITS } = require("./menu-csv.cjs");

let n = 0;
const newId = (p: string) => `${p}new${++n}`;
const existing = () => ({
  categories: [
    { id: "c1", name: "Starters", sortOrder: 1 },
    { id: "c2", name: "Mains", sortOrder: 2 },
  ],
  items: [
    { id: "m1", categoryId: "c1", name: "Paneer Tikka", shortCode: "PT", pricePaise: 22000, veg: true, available: true },
    { id: "m2", categoryId: "c2", name: "Chicken Curry", shortCode: "CC", pricePaise: 28000, veg: false, available: true },
  ],
});
const HEAD = "Category,Name,Price,Veg,Short code,Available";

describe("reading CSV text", () => {
  it("splits plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n").records.map((r: { cells: string[] }) => r.cells)).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quotes, commas inside quotes, doubled quotes and line breaks inside quotes", () => {
    const r = parseCsv('Name,Note\n"Dal, Tadka","He said ""hi"""\n"Two\nlines",x\n').records;
    expect(r[1].cells).toEqual(["Dal, Tadka", 'He said "hi"']);
    expect(r[2].cells).toEqual(["Two\nlines", "x"]);
    expect(r[2].line).toBe(3); // the line a record STARTS on, for error messages
  });

  it("accepts Windows and old Mac line breaks, a byte-order mark, and no final newline", () => {
    expect(parseCsv("﻿a,b\r\n1,2").records.map((r: { cells: string[] }) => r.cells)).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2\r").records).toHaveLength(2);
  });

  it("detects a semicolon or tab separator (Excel follows the PC's regional settings)", () => {
    expect(parseCsv("a;b\n1;2").records[1].cells).toEqual(["1", "2"]);
    expect(parseCsv("a\tb\n1\t2").records[1].cells).toEqual(["1", "2"]);
    expect(parseCsv('"a;b",c\n1,2').records[1].cells).toEqual(["1", "2"]); // a ; inside quotes is not a separator
  });

  it("skips blank lines and rows of only commas (Excel leaves these at the end)", () => {
    expect(parseCsv("a,b\n\n1,2\n,,\n\n").records).toHaveLength(2);
  });

  it("reports a quote that is never closed instead of swallowing the rest of the file", () => {
    expect(parseCsv('a,b\n"oops,1\n2,3\n').error).toMatch(/never closed/);
  });
});

describe("prices and yes/no values", () => {
  it("reads money the way people write it", () => {
    expect(parsePrice("120")).toBe(12000);
    expect(parsePrice("120.5")).toBe(12050);
    expect(parsePrice("120.50")).toBe(12050);
    expect(parsePrice("₹1,250.50")).toBe(125050);
    expect(parsePrice("Rs. 99")).toBe(9900);
    expect(parsePrice("INR 10")).toBe(1000);
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice("0.05")).toBe(5);
    expect(parsePrice("1,25,000")).toBe(12500000); // Indian digit grouping
    expect(parsePrice("12,500")).toBe(1250000);
    expect(parsePrice(" 99 ")).toBe(9900);
  });

  it("refuses anything that is not a money amount", () => {
    for (const bad of ["", "abc", "-5", "+5", "1.234", "12.", ".5", "1e3", "12,3,4x", "1,2", "NaN", "10 20", "1 250", "9999999.99", "99999999", "₹", "Rs"]) expect(parsePrice(bad)).toBeNull();
  });

  it("understands veg and yes/no wording, and blank means the default", () => {
    for (const y of ["Y", "yes", "Veg", "TRUE", "1", " v "]) expect(parseFlag(y, false)).toBe(true);
    for (const no of ["n", "No", "Non-veg", "non veg", "nonveg", "false", "0", "NV"]) expect(parseFlag(no, true)).toBe(false);
    expect(parseFlag("", true)).toBe(true);
    expect(parseFlag("  ", false)).toBe(false);
    expect(parseFlag("maybe", true)).toBeUndefined();
  });
});

describe("checking a menu file", () => {
  it("accepts a normal file and returns tidy rows", () => {
    const r = readMenuCsv(`${HEAD}\nStarters,Paneer Tikka,220,Veg,PT,Yes\nMains,  Dal   Makhani ,"1,100.50",Veg,,No\n`);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, category: "Starters", name: "Paneer Tikka", pricePaise: 22000, veg: true, available: true, shortCode: "PT" },
      { line: 3, category: "Mains", name: "Dal Makhani", pricePaise: 110050, veg: true, available: false, shortCode: "" },
    ]);
  });

  it("understands other column titles and any column order, and lists columns it ignores", () => {
    const r = readMenuCsv("Dish,Rate,Section,Notes\nNaan,40,Breads,fresh\n");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: "Naan", pricePaise: 4000, category: "Breads" });
    expect(r.ignoredColumns).toEqual(["Notes"]);
  });

  it("works with only Name and Price: everything else gets a sensible default", () => {
    const r = readMenuCsv("name,price\nTea,15\n");
    expect(r.rows[0]).toEqual({ line: 2, category: "Imported", name: "Tea", pricePaise: 1500, veg: true, available: true, shortCode: "" });
  });

  it("refuses a file without Name and Price columns, and says what it found", () => {
    const r = readMenuCsv("Food,Cost\nTea,15\n");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toMatch(/Name.*Price.*found: food, cost/);
  });

  it("refuses an empty file, a title row only, and a file that is too big", () => {
    expect(readMenuCsv("").errors[0].message).toMatch(/empty/);
    expect(readMenuCsv(HEAD + "\n").errors[0].message).toMatch(/no items/);
    expect(readMenuCsv("x".repeat(LIMITS.bytes + 1)).errors[0].message).toMatch(/larger than 2 MB/);
    const tooMany = HEAD + "\n" + Array.from({ length: LIMITS.rows + 1 }, (_, i) => `A,Item ${i},1,Veg,,Yes`).join("\n");
    expect(readMenuCsv(tooMany).errors[0].message).toMatch(/limit is 5000/);
  });

  it("is all or nothing: one bad row refuses the file, and every bad row is listed with its line", () => {
    const r = readMenuCsv(`${HEAD}\nA,Good,10,Veg,,Yes\nA,,10,Veg,,Yes\nA,Bad price,abc,Veg,,Yes\nA,Bad veg,10,sometimes,,Yes\nA,Bad code,10,Veg,"AB CD!",Yes\nA,${"x".repeat(81)},10,Veg,,Yes\n`);
    expect(r.rows).toEqual([]); // nothing usable is returned
    expect(r.errors.map((e: { line: number }) => e.line)).toEqual([3, 4, 5, 6, 7]);
    expect(r.errors[0].message).toMatch(/name is empty/);
    expect(r.errors[1].message).toMatch(/price "abc"/);
    expect(r.errors[2].message).toMatch(/Veg value "sometimes"/);
    expect(r.errors[3].message).toMatch(/short code/);
    expect(r.errors[4].message).toMatch(/longer than 80/);
  });

  it("refuses the same item twice in one file, pointing at the first one", () => {
    const r = readMenuCsv(`${HEAD}\nMains,Naan,40,Veg,,Yes\nmains,  NAAN ,45,Veg,,Yes\n`);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ line: 3 });
    expect(r.errors[0].message).toMatch(/repeats "NAAN" in "mains" from line 2/);
  });

  it("allows the same name in different categories", () => {
    expect(readMenuCsv(`${HEAD}\nStarters,Soup,100,Veg,,Yes\nMains,Soup,150,Veg,,Yes\n`).errors).toEqual([]);
  });

  it("flags a stray comma inside an unquoted name (too many values)", () => {
    const r = readMenuCsv(`${HEAD}\nMains,Dal, Tadka,150,Veg,,Yes\n`);
    expect(r.errors[0].message).toMatch(/more values than the title row/);
  });

  it("never evaluates anything: a formula-looking name is just text, and invisible control characters are removed", () => {
    const r = readMenuCsv(`${HEAD}\nMains,"=HYPERLINK(""http://evil"")",10,Veg,,Yes\nMains,"Naan\u0007\u0000",10,Veg,,Yes\n`);
    expect(r.errors).toEqual([]);
    expect(r.rows[0].name).toBe('=HYPERLINK("http://evil")');
    expect(r.rows[1].name).toBe("Naan");
  });

  it("never throws, whatever it is given", () => {
    for (const junk of [null, undefined, 5, "\u0000\u0001", "\"", ",,,\n,,,", "a,b\n\"\"\"\"\"\"", "name,price\n,\n", { a: 1 }]) {
      expect(() => readMenuCsv(junk as string)).not.toThrow();
    }
  });
});

describe("planning an import", () => {
  const rows = (...r: { category: string; name: string; pricePaise: number; veg?: boolean; available?: boolean; shortCode?: string }[]) =>
    r.map((x, i) => ({ line: i + 2, veg: true, available: true, shortCode: "", ...x }));

  it("adds new items and new categories", () => {
    const p = planImport(rows({ category: "Breads", name: "Naan", pricePaise: 4000 }, { category: "Starters", name: "Soup", pricePaise: 9000 }), existing(), newId);
    expect(p.ok).toBe(true);
    expect(p.newCategories.map((c: { name: string }) => c.name)).toEqual(["Breads"]);
    expect(p.newCategories[0].sortOrder).toBe(3);
    expect(p.creates).toHaveLength(2);
    expect(p.creates[1].categoryId).toBe("c1"); // an existing category, matched ignoring case
    expect(p.updates).toEqual([]);
  });

  it("updates an existing item (same category and name, ignoring case) only where something differs", () => {
    const p = planImport(rows({ category: "starters", name: "PANEER TIKKA", pricePaise: 24000 }, { category: "Mains", name: "Chicken Curry", pricePaise: 28000, veg: false }), existing(), newId);
    expect(p.creates).toEqual([]);
    expect(p.unchanged).toBe(1);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0]).toMatchObject({ id: "m1", name: "Paneer Tikka", patch: { pricePaise: 24000 } });
    expect(Object.keys(p.updates[0].patch)).toEqual(["pricePaise"]); // veg, availability and code untouched
  });

  it("never deletes: items missing from the file are simply not mentioned", () => {
    const p = planImport(rows({ category: "Breads", name: "Naan", pricePaise: 4000 }), existing(), newId);
    expect(p.updates).toEqual([]);
    expect(p.creates).toHaveLength(1);
  });

  it("an existing short code is only changed when the file gives a different one", () => {
    const same = planImport(rows({ category: "Starters", name: "Paneer Tikka", pricePaise: 22000, shortCode: "PT" }), existing(), newId);
    expect(same.unchanged).toBe(1);
    const diff = planImport(rows({ category: "Starters", name: "Paneer Tikka", pricePaise: 22000, shortCode: "TIKKA" }), existing(), newId);
    expect(diff.updates[0].patch).toEqual({ shortCode: "TIKKA" });
  });

  it("same name in another category is a new item, not an update", () => {
    const p = planImport(rows({ category: "Mains", name: "Paneer Tikka", pricePaise: 25000 }), existing(), newId);
    expect(p.updates).toEqual([]);
    expect(p.creates).toHaveLength(1);
  });

  it("makes readable, unique short codes for new items", () => {
    const p = planImport(
      rows(
        { category: "Mains", name: "Paneer Butter Masala", pricePaise: 1 },
        { category: "Mains", name: "Palak Bhaji Mix", pricePaise: 1 }, // same initials: numbered
        { category: "Mains", name: "Pav Bhaji Masala", pricePaise: 1 },
        { category: "Breads", name: "Naan", pricePaise: 1 }, // one word: its first three letters
        { category: "Breads", name: "Chapati", pricePaise: 1, shortCode: "NAN" }, // a code from the file is kept
        { category: "Starters", name: "Tea", pricePaise: 1 },
        { category: "Breads", name: "Tea", pricePaise: 1 },
      ),
      existing(),
      newId,
    );
    const codes = p.creates.map((c: { shortCode: string }) => c.shortCode);
    expect(codes).toEqual(["PBM", "PBM2", "PBM3", "NAA", "NAN", "TEA", "TEA2"]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("a short code from the file never clashes with one already on the menu", () => {
    const p = planImport(rows({ category: "Mains", name: "Pan Tikka", pricePaise: 1 }), existing(), newId); // initials PT, already used by Paneer Tikka
    expect(p.creates[0].shortCode).toBe("PT2");
  });

  it("refuses an import that would go past 200 categories", () => {
    const many = Array.from({ length: 199 }, (_, i) => ({ category: `Cat ${i}`, name: `Item ${i}`, pricePaise: 1 }));
    expect(planImport(rows(...many), existing(), newId).ok).toBe(false);
    expect(planImport(rows(...many.slice(0, 197)), existing(), newId).ok).toBe(true);
  });

  it("makeShortCode copes with odd names", () => {
    const taken = new Set<string>();
    expect(makeShortCode("Tea", taken)).toBe("TEA");
    expect(makeShortCode("Tea", taken)).toBe("TEA2");
    expect(makeShortCode("!!!", taken)).toMatch(/^[A-Z0-9]{2,}$/);
    expect(makeShortCode("७७ चाय", taken).length).toBeGreaterThanOrEqual(2);
  });
});

describe("writing a CSV file", () => {
  const cats = [
    { id: "c1", name: "Starters", sortOrder: 1 },
    { id: "c2", name: "Mains", sortOrder: 2 },
  ];

  it("writes a title row and one line per item, in menu order, with prices in rupees", () => {
    const csv = toCsv(cats, [
      { id: "m2", categoryId: "c2", name: "Dal", shortCode: "DAL", pricePaise: 15050, veg: true, available: false },
      { id: "m1", categoryId: "c1", name: "Soup", shortCode: "SP", pricePaise: 9000, veg: false, available: true },
    ]);
    expect(csv.startsWith("﻿")).toBe(true); // Excel shows every character correctly
    expect(csv.split("\r\n")).toEqual([`﻿Category,Name,Price,Veg,Short code,Available`, "Starters,Soup,90.00,Non-veg,SP,Yes", "Mains,Dal,150.50,Veg,DAL,No", ""]);
  });

  it("quotes commas, quotes and line breaks", () => {
    const csv = toCsv(cats, [{ id: "m1", categoryId: "c1", name: 'Dal, "Tadka"\nSpecial', shortCode: "D", pricePaise: 100, veg: true, available: true }]);
    expect(csv).toContain('"Dal, ""Tadka""\nSpecial"');
  });

  it("protects cells a spreadsheet would run as formulas", () => {
    const csv = toCsv(cats, [{ id: "m1", categoryId: "c1", name: "=1+1", shortCode: "-X", pricePaise: 100, veg: true, available: true }]);
    expect(csv).toContain("Starters,'=1+1,1.00,Veg,'-X,Yes");
  });

  it("leaves out items whose category was removed", () => {
    expect(toCsv(cats, [{ id: "m1", categoryId: "gone", name: "Ghost", shortCode: "G", pricePaise: 1, veg: true, available: true }])).not.toContain("Ghost");
  });

  it("round trip: an exported file imports back with the same items, even awkward ones", () => {
    const items = [
      { id: "m1", categoryId: "c1", name: 'Dal, "Tadka"', shortCode: "DT", pricePaise: 15050, veg: true, available: true },
      { id: "m2", categoryId: "c1", name: "=SUM(A1)", shortCode: "-1", pricePaise: 100, veg: false, available: false },
      { id: "m3", categoryId: "c2", name: "चाय (Tea)", shortCode: "TEA", pricePaise: 1500, veg: true, available: true },
    ];
    const back = readMenuCsv(toCsv(cats, items));
    expect(back.errors).toEqual([]);
    expect(back.rows.map((r: { name: string; pricePaise: number; veg: boolean; available: boolean; shortCode: string; category: string }) => [r.category, r.name, r.pricePaise, r.veg, r.available, r.shortCode])).toEqual([
      ["Starters", "=SUM(A1)", 100, false, false, "-1"], // the export lists items by name within a category
      ["Starters", 'Dal, "Tadka"', 15050, true, true, "DT"],
      ["Mains", "चाय (Tea)", 1500, true, true, "TEA"],
    ]);
    // and importing it onto the same menu changes nothing
    const plan = planImport(back.rows, { categories: cats, items }, newId);
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toBe(3);
  });
});

describe("reading the file's bytes (Excel's different CSV kinds)", () => {
  const text = "Name,Price\nCrème Brûlée,150\nचाय,15\n";

  it("UTF-8 with a byte-order mark (Excel's 'CSV UTF-8')", () => {
    const r = decodeCsvBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]));
    expect(r).toEqual({ text, encoding: "UTF-8" });
  });

  it("UTF-8 without a mark", () => {
    expect(decodeCsvBuffer(Buffer.from(text, "utf8"))).toEqual({ text, encoding: "UTF-8" });
  });

  it("UTF-16 in either byte order (Excel's 'Unicode Text')", () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(decodeCsvBuffer(le)).toEqual({ text, encoding: "UTF-16" });
    const be = Buffer.from(le.subarray(2));
    be.swap16();
    expect(decodeCsvBuffer(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toEqual({ text, encoding: "UTF-16" });
  });

  it("the old Windows character set (Excel's plain 'CSV'): accented letters survive", () => {
    // "Crème Brûlée" saved by Excel as plain CSV: è = 0xE8, û = 0xFB, é = 0xE9
    const bytes = Buffer.from([0x4e, 0x61, 0x6d, 0x65, 0x2c, 0x50, 0x72, 0x69, 0x63, 0x65, 0x0a, 0x43, 0x72, 0xe8, 0x6d, 0x65, 0x20, 0x42, 0x72, 0xfb, 0x6c, 0xe9, 0x65, 0x2c, 0x31, 0x35, 0x30, 0x0a]);
    const r = decodeCsvBuffer(bytes);
    expect(r.encoding).toBe("Windows-1252");
    expect(readMenuCsv(r.text).rows[0]).toMatchObject({ name: "Crème Brûlée", pricePaise: 15000 });
  });

  it("a whole file read this way imports correctly, in any of the kinds", () => {
    for (const bytes of [Buffer.from("\uFEFF" + text, "utf8"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])]) {
      const rows = readMenuCsv(decodeCsvBuffer(bytes).text).rows;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(["Crème Brûlée", "चाय"]);
    }
  });

  it("never throws, even on random bytes or an empty file", () => {
    expect(() => decodeCsvBuffer(Buffer.alloc(0))).not.toThrow();
    expect(() => decodeCsvBuffer(Buffer.from([0xff]))).not.toThrow();
    expect(() => decodeCsvBuffer(Buffer.from(Array.from({ length: 500 }, (_, i) => (i * 37) % 256)))).not.toThrow();
  });
});
