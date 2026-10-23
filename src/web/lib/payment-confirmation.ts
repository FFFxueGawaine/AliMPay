import type { CheckoutData } from "../../shared/contracts";

export function paymentConfirmation(data: CheckoutData | undefined, token: string, now: number) {
  const parseCents = (value: string) => {
    if (!/^\d+\.\d{2}$/.test(value)) return null;
    const cents = Number(value.replace(".", ""));
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  };
  const requested = data ? parseCents(data.requested_money) : null;
  const payable = data ? parseCents(data.payable_money) : null;
  const validAmount = requested !== null && payable !== null && payable > 0;
  const adjustment = validAmount ? payable - requested : 0;
  const yuan = validAmount ? Math.floor(payable / 100) : 0;
  const jiao = validAmount ? Math.floor(payable % 100 / 10) : 0;
  const fen = validAmount ? payable % 10 : 0;
  return {
    key: data ? JSON.stringify([token, data.trade_no, data.requested_money, data.payable_money, data.collection_mode, data.payment_uri]) : "",
    canPay: Boolean(data && validAmount && data.status === "pending" && now < Date.parse(data.expires_at) && now < Date.parse(data.monitor_until)),
    adjustment: adjustment > 0 ? `${Math.floor(adjustment / 100)}.${String(adjustment % 100).padStart(2, "0")}` : null,
    isIdentificationAmount: data?.collection_mode === "business_qr" && adjustment > 0,
    amountInWords: validAmount ? `${yuan} 元${jiao ? ` ${jiao} 角` : ""}${fen ? ` ${fen} 分` : ""}${!jiao && !fen ? "整" : ""}` : "",
    mistakenMoney: validAmount && !jiao && fen ? `${yuan}.${fen}0` : null,
  };
}
