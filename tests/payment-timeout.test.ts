import { createSign } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { OfficialAlipayProvider, PaymentScanner, type AccountLogPage } from "../src/server/alipay";
import { setSetting } from "../src/server/db";
import { createOrder, getOrderById } from "../src/server/orders";
import { configuredDatabase, orderInput } from "./helpers";

describe("payment query deadlines", () => {
  it("aborts a stalled SDK request and successfully queries again", async () => {
    const { database, alipay } = configuredDatabase();
    let stalled = true;
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch() {
        if (stalled) return new Promise<Response>(() => {});
        const body = JSON.stringify({ page_no: 1, page_size: 2000, total_size: 0, detail_list: [] });
        const timestamp = String(Date.now());
        const nonce = "timeout-test";
        const signature = createSign("RSA-SHA256").update(`${timestamp}\n${nonce}\n${body}\n`).sign(alipay.privateKey, "base64");
        return new Response(body, { headers: {
          "content-type": "application/json", "alipay-timestamp": timestamp,
          "alipay-nonce": nonce, "alipay-signature": signature,
        } });
      },
    });
    let guard: ReturnType<typeof setTimeout> | undefined;
    try {
      setSetting(database, "alipay_endpoint", server.url.origin);
      const provider = new OfficialAlipayProvider(database);
      const input = { startTime: "2026-10-22 00:00:00", endTime: "2026-10-22 01:00:00", pageNo: 1, pageSize: 2000 };
      const started = Date.now();
      const result = await Promise.race([
        provider.query(input).then(() => "unexpected success", () => "aborted"),
        new Promise<string>((resolve) => { guard = setTimeout(() => resolve("still blocked"), 11_000); }),
      ]);
      expect(result).toBe("aborted");
      expect(Date.now() - started).toBeLessThan(10_000);
      stalled = false;
      expect((await provider.query(input)).details).toEqual([]);
    } finally {
      clearTimeout(guard);
      server.stop(true);
      database.close();
    }
  }, 15_000);

  it("releases a stuck scanner and ignores its late result without duplicate payment or notification", async () => {
    const { database } = configuredDatabase();
    let resolveStalled!: (page: AccountLogPage) => void;
    let calls = 0;
    const order = createOrder(database, orderInput()).order;
    const page: AccountLogPage = {
      pageNo: 1, pageSize: 2000, totalSize: 1, traceId: "timeout-test",
      details: [{ account_log_id: "TIMEOUT-1", trans_dt: new Date().toISOString(), direction: "收入", trans_amount: "1.01" }],
    };
    const scanner = new PaymentScanner(database, {
      query: async () => ++calls === 1 ? new Promise<AccountLogPage>((resolve) => { resolveStalled = resolve; }) : page,
    });
    try {
      const first = scanner.scanNow();
      expect(scanner.scanNow()).toBe(first);
      await expect(first).rejects.toThrow("deadline");
      expect(getOrderById(database, order.id)?.status).toBe("pending");
      expect(database.query("SELECT status FROM scan_runs ORDER BY id DESC LIMIT 1").get()).toEqual({ status: "error" });
      expect((await scanner.scanNow()).matched).toBe(1);
      resolveStalled(page);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(getOrderById(database, order.id)?.status).toBe("paid");
      expect(database.query("SELECT COUNT(*) AS n FROM notification_jobs").get()).toEqual({ n: 1 });
      expect(database.query("SELECT COUNT(*) AS n FROM payment_events").get()).toEqual({ n: 1 });
      expect(database.query("SELECT status FROM scan_runs ORDER BY id").all()).toEqual([{ status: "error" }, { status: "success" }]);
    } finally {
      resolveStalled(page);
      database.close();
    }
  }, 15_000);
});
