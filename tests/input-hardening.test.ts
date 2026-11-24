import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sanitizeMessage } from "@/core/sanitize";

describe("message sanitising", () => {
  it("normalises to NFC", () => {
    expect(sanitizeMessage("é")).toBe("é");
  });
  it("strips control characters but keeps tab and newlines", () => {
    expect(sanitizeMessage("a\u0000b\u0007c\u009fd\te\r\nf")).toBe("abcd\te\nf");
  });
  it("strips RTL override and zero-width characters used to disguise text", () => {
    expect(sanitizeMessage("pay‮gnirts‬​now﻿⁦x⁩")).toBe("paygnirtsnowx");
  });
  it("keeps ZWJ/ZWNJ that Indic scripts need", () => {
    const te = "క్ష‍ా";
    expect(sanitizeMessage(te)).toBe(te.normalize("NFC"));
  });
  it("leaves <script>, markdown and quoted instructions as inert text (rendering escapes them)", () => {
    const raw = "<script>alert(1)</script> **bold** [x](javascript:alert(1)) ![i](http://e/x.png) <img src=x onerror=alert(1)>";
    const clean = sanitizeMessage(raw);
    expect(clean).toBe(raw);
    const html = renderToStaticMarkup(createElement("p", null, clean));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});
