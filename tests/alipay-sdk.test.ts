import { createPrivateKey, createPublicKey, createSign } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "bun:test";
import { AlipaySdk } from "alipay-sdk";
import { OfficialAlipayProvider, prepareAlipaySdkPem } from "../src/server/alipay";
import { setSetting } from "../src/server/db";
import { generateRsaKeyPair } from "../src/server/security";
import { configuredDatabase } from "./helpers";

describe("Alipay SDK key compatibility", () => {
  it("reads negotiated account-log responses on Bun and still rejects invalid signatures", async () => {
    const { database, alipay } = configuredDatabase();
    let invalidSignature = false;
    let encoding = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        encoding = request.headers.get("accept-encoding") ?? "";
        const body = JSON.stringify({ page_no: 1, page_size: 2000, total_size: 0, detail_list: [] });
        const timestamp = String(Date.now());
        const nonce = "test-nonce";
        const signature = createSign("RSA-SHA256").update(`${timestamp}\n${nonce}\n${invalidSignature ? "tampered" : body}\n`).sign(alipay.privateKey, "base64");
        const headers = {
          "content-type": "application/json",
          "alipay-timestamp": timestamp,
          "alipay-nonce": nonce,
          "alipay-signature": signature,
        };
        return encoding === "identity"
          ? new Response(body, { headers })
          : new Response(gzipSync(body), { headers: { ...headers, "content-encoding": "gzip" } });
      },
    });
    try {
      setSetting(database, "alipay_endpoint", server.url.origin);
      const provider = new OfficialAlipayProvider(database);
      const input = { startTime: "2026-09-28 00:00:00", endTime: "2026-09-28 01:00:00", pageNo: 1, pageSize: 2000 };
      expect((await provider.query(input)).details).toEqual([]);
      expect(encoding).toBe("identity");
      invalidSignature = true;
      await expect(provider.query(input)).rejects.toThrow("响应验签失败");
    } finally {
      server.stop(true);
      database.close();
    }
  });

  it("removes trailing PEM whitespace before the SDK formats generated keys", () => {
    const pair = generateRsaKeyPair();
    expect(pair.privateKey.endsWith("\n")).toBe(true);

    const sdk = new AlipaySdk({
      appId: "2026000000000000",
      privateKey: prepareAlipaySdkPem(pair.privateKey),
      alipayPublicKey: prepareAlipaySdkPem(pair.publicKey),
      keyType: "PKCS8",
      signType: "RSA2",
    });

    expect(() => createPrivateKey(sdk.config.privateKey)).not.toThrow();
    expect(() => createPublicKey(sdk.config.alipayPublicKey!)).not.toThrow();
    expect(() => createSign("RSA-SHA256").update("probe").sign(sdk.config.privateKey)).not.toThrow();
  });
});
