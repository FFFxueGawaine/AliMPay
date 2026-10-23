import { CheckCircle2, Clock3, ExternalLink, ScanLine, ShieldCheck, TriangleAlert } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import { PAYMENT_POLL_INTERVAL_DEFAULT_SECONDS, type CheckoutData } from "@/shared/contracts";
import { swrFetcher } from "@/web/api";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/web/components/ui/dialog";
import { Loading } from "@/web/components/ui/loading";
import { paymentConfirmation } from "@/web/lib/payment-confirmation";
import { formatDate } from "@/web/lib/utils";

function countdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function isMobileBrowser() {
  const browserNavigator = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (browserNavigator.userAgentData?.mobile === true) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(browserNavigator.userAgent) ||
    (/Macintosh/i.test(browserNavigator.userAgent) && browserNavigator.maxTouchPoints > 1);
}

// Keep this callback stable so the one-second countdown does not reset SWR's polling timer.
function paymentRefreshInterval(latest: CheckoutData | undefined) {
  if (latest && (["paid", "late_paid"].includes(latest.status) || Date.parse(latest.monitor_until) <= Date.now())) return 0;
  return (latest?.payment_poll_interval_seconds ?? PAYMENT_POLL_INTERVAL_DEFAULT_SECONDS) * 1_000;
}

export function CheckoutPage() {
  const { token = "" } = useParams();
  const [now, setNow] = useState(Date.now());
  const [qrImageFailed, setQrImageFailed] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState("");
  const [dismissedKey, setDismissedKey] = useState("");
  const confirmTrigger = useRef<HTMLButtonElement>(null);
  const paymentHeading = useRef<HTMLHeadingElement>(null);
  const mobileRedirectAttempted = useRef(false);
  const { data, error, isLoading } = useSWR<CheckoutData>(`/public-api/checkout/${encodeURIComponent(token)}`, swrFetcher, {
    refreshInterval: paymentRefreshInterval,
    shouldRetryOnError: false,
  });
  const confirmation = paymentConfirmation(data, token, now);
  const amountConfirmed = confirmation.canPay && confirmedKey === confirmation.key;
  const confirmationOpen = confirmation.canPay && !amountConfirmed && dismissedKey !== confirmation.key;
  const { data: generatedQr, error: generatedQrError } = useSWR(
    data?.collection_mode === "transfer" && data.payment_uri ? ["transfer-qr", data.payment_uri] : null,
    ([, uri]) => QRCode.toDataURL(uri, { scale: 10, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }),
  );

  useEffect(() => {
    setQrImageFailed(false);
  }, [data?.business_qr_url, generatedQr]);

  useEffect(() => {
    mobileRedirectAttempted.current = false;
  }, [confirmation.key]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      mobileRedirectAttempted.current ||
      !amountConfirmed ||
      !data ||
      data.collection_mode !== "transfer" ||
      data.status !== "pending" ||
      !data.payment_uri ||
      Date.parse(data.expires_at) <= Date.now() ||
      !isMobileBrowser()
    ) return;

    mobileRedirectAttempted.current = true;
    window.location.assign(data.payment_uri);
  }, [data, amountConfirmed]);

  if (isLoading) return <Loading label="正在读取支付订单" />;
  if (error || !data) return <main className="flex min-h-screen items-center justify-center bg-[#faf9f6] px-4 font-[system-ui]"><div className="max-w-sm text-center"><TriangleAlert className="mx-auto size-9 text-destructive" /><h1 className="mt-4 text-xl font-semibold">订单不存在</h1><p className="mt-2 text-sm text-muted">链接可能无效，或订单信息无法读取。</p></div></main>;

  const paid = data.status === "paid" || data.status === "late_paid";
  const checkoutExpired = now >= Date.parse(data.expires_at);
  const monitoringEnded = now >= Date.parse(data.monitor_until);

  if (paid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#faf9f6] px-4 font-[system-ui] py-12">
        <Card className="w-full max-w-md rounded-[28px] border-[#e6ebf4] bg-white shadow-[0_4px_24px_-8px_rgba(24,34,59,0.12)]"><CardContent className="px-6 py-10 text-center"><CheckCircle2 className="mx-auto size-12 text-success" /><Badge className="mt-5" variant={data.status === "late_paid" ? "primary" : "success"}>{data.status === "late_paid" ? "迟到支付已确认" : "支付成功"}</Badge><h1 className="mt-4 text-2xl font-semibold tracking-tight">已收到 ¥{data.payable_money}</h1><p className="mt-2 break-all text-sm text-muted">订单 {data.out_trade_no} 已确认收款，正在同步商户订单。</p>{data.return_target ? <Button className="mt-6 w-full" asChild><a href={data.return_target}>返回商户页面<ExternalLink /></a></Button> : null}<p className="mt-5 text-xs text-muted">如商户订单尚未更新，请稍后查看，请勿重复付款。</p></CardContent></Card>
      </main>
    );
  }

  if (monitoringEnded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#faf9f6] px-4 font-[system-ui] py-12"><Card className="w-full max-w-md rounded-[28px] border-[#e6ebf4] bg-white shadow-[0_4px_24px_-8px_rgba(24,34,59,0.12)]"><CardContent className="px-6 py-10 text-center"><Clock3 className="mx-auto size-10 text-destructive" /><h1 className="mt-4 text-xl font-semibold">订单确认窗口已结束</h1><p className="mt-2 text-sm leading-6 text-muted">系统未在 10 分钟内匹配到支付。请不要继续付款，并返回商户重新创建订单。</p><div className="mt-6 rounded-md border p-3 text-left text-xs text-muted">商户订单号：<span className="font-mono text-foreground">{data.out_trade_no}</span></div></CardContent></Card></main>
    );
  }

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-6 font-[system-ui] text-[#18223b] sm:py-10">
      <Dialog open={confirmationOpen} onOpenChange={(open) => { if (!open) setDismissedKey(confirmation.key); }}>
        <DialogContent
          className="flex max-h-[calc(100dvh-2rem)] max-w-[480px] flex-col overflow-hidden rounded-[28px] border-[#e6ebf4] bg-white p-5 font-[system-ui] text-[#18223b] sm:p-8 [&>button:last-child]:size-11 [&>button:last-child]:p-3"
          onCloseAutoFocus={(event) => { event.preventDefault(); (confirmedKey === confirmation.key ? paymentHeading.current : confirmTrigger.current)?.focus(); }}
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain">
          <div aria-hidden="true" className="mb-3 text-center text-5xl">✋</div>
          <DialogTitle className="text-center text-xl font-bold sm:text-2xl">先别急！看清小数点</DialogTitle>
          <DialogDescription className="mt-2 text-center text-sm leading-6 text-slate-600">
            小数点后要有两位，0 也要输入。
          </DialogDescription>
          <div className="mt-5 rounded-[20px] border-2 border-[#0758ce] bg-[#eef5ff] p-4 text-center">
            <p className="text-sm font-medium text-[#0758ce]">本单请准确支付</p>
            <p className="my-2 break-all text-5xl font-bold leading-tight tracking-tight tabular-nums sm:text-6xl">¥{data.payable_money.slice(0, -2)}<span className="text-red-700">{data.payable_money.slice(-2)}</span></p>
            <p className="text-xl font-bold text-[#0758ce]">{confirmation.amountInWords}</p>
          </div>
          {confirmation.mistakenMoney ? <p className="mt-4 rounded-2xl bg-red-50 p-3 text-center font-bold leading-7 text-red-800">不是 ¥{confirmation.mistakenMoney}！<br /><span className="text-sm">别漏掉小数点后的 0</span></p> : null}
          <p className="mt-4 text-center text-sm leading-6 text-slate-700">请核对支付宝确认页：金额必须是 <strong className="whitespace-nowrap">¥{data.payable_money}</strong>。<br />多付或少付都可能导致订单无法自动到账。</p>
          {confirmation.adjustment ? <p className="mt-3 text-center text-xs leading-5 text-slate-500">订单金额 ¥{data.requested_money}，本次{confirmation.isIdentificationAmount ? "识别尾数" : "金额调整"} +¥{confirmation.adjustment}，已计入应付金额。</p> : null}
          </div>
          <Button className="mt-5 min-h-12 w-full shrink-0 whitespace-normal rounded-2xl bg-[#0758ce] px-3 py-3 text-base font-semibold text-white hover:bg-[#0648a9]" onClick={() => setConfirmedKey(confirmation.key)}>我确认支付 ¥{data.payable_money}</Button>
        </DialogContent>
      </Dialog>
      <div className="mx-auto max-w-[900px]">
        <header className="mb-7 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-[14px] bg-[#007aff] text-white shadow-[0_4px_12px_-4px_rgba(0,122,255,0.4)]"><ScanLine className="size-6" aria-hidden="true" /></span><div><p className="text-lg font-semibold tracking-tight">支付宝付款</p><p className="mt-0.5 text-xs text-slate-500">AliMPay 收银台</p></div></div>
          <span className="flex items-center gap-1.5 text-xs text-slate-600"><ShieldCheck className="size-4 text-[#0758ce]" aria-hidden="true" />订单支付</span>
        </header>
        <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="min-w-0 overflow-hidden rounded-[28px] border-[#e6ebf4] bg-white shadow-[0_4px_8px_-4px_rgba(24,34,59,0.05),0_18px_48px_-20px_rgba(24,34,59,0.14)]">
            <CardContent className="p-0">
              <div className="px-5 pb-5 pt-7 text-center sm:px-8 sm:pt-8">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${checkoutExpired ? "bg-red-50 text-red-700" : "bg-[#eef5ff] text-[#0758ce]"}`}><Clock3 className="size-3.5" aria-hidden="true" />{checkoutExpired ? "付款时间已过，等待到账确认" : <>请在 <span className="tabular-nums">{countdown(Date.parse(data.expires_at) - now)}</span> 内完成付款</>}</span>
                <p className="mt-6 text-[13px] font-medium text-slate-500">本单应付金额（元）</p>
                <h1 ref={paymentHeading} tabIndex={-1} className="mt-1 break-all text-[48px] font-semibold leading-tight tracking-[-0.045em] text-[#18223b] tabular-nums sm:text-[60px]">¥{data.payable_money}</h1>
                <p className="mt-2 break-words text-[13px] text-slate-500">{data.name}</p>
              </div>

              <div className="px-4 pb-6 pt-2 sm:px-8 sm:pb-8">
                <div className="rounded-[18px] bg-[#eef5ff] px-4 py-3.5 text-center">
                  <h2 className="text-balance text-sm font-semibold leading-6 text-[#0758ce]">{checkoutExpired ? "付款时间已过，请勿继续付款" : `请准确支付本单应付金额 ¥${data.payable_money}`}</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{checkoutExpired ? "已付款请等待确认，尚未付款请返回商户重新下单。" : "确认付款前，请核对金额与本单应付一致。"}</p>
                </div>
                {confirmation.adjustment ? <p className="mt-3 text-center text-sm leading-6 text-slate-600">订单金额 ¥{data.requested_money} + 本次增加 <strong className="font-semibold text-amber-800">¥{confirmation.adjustment}</strong><br />{confirmation.isIdentificationAmount ? "增加部分为自动分配的订单识别尾数，请精确到分。" : "请按实际应付金额付款。"}</p> : null}

                {amountConfirmed ? <>
                <div className="mt-5 rounded-[18px] border-2 border-red-200 bg-red-50 px-3 py-3 text-center text-red-900">
                  <p className="text-sm font-bold"><span aria-hidden="true">✋ </span>看清小数点，一分也别差</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">¥{data.payable_money} = {confirmation.amountInWords}</p>
                  <p className="mt-1 text-sm font-semibold">{confirmation.mistakenMoney ? `不是 ¥${confirmation.mistakenMoney}，0 也要输入！` : "小数点后保留两位，请勿取整。"}</p>
                </div>
                <div className="mx-auto mt-5 flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-[22px] border border-[#e6ebf4] bg-white shadow-[0_4px_16px_-8px_rgba(24,34,59,0.12)]">
                  {qrImageFailed || generatedQrError || (data.collection_mode === "business_qr" && !data.business_qr_url) ? <div role="alert" className="p-5 text-center"><TriangleAlert className="mx-auto size-7 text-amber-600" aria-hidden="true" /><p className="mt-3 text-sm font-medium">二维码暂未加载</p><p className="mt-1 text-xs leading-5 text-slate-600">请检查网络后刷新页面。</p></div> : data.collection_mode === "business_qr" ? (
                    // ponytail: crop only this verified poster; future uploads retain the full image until crop metadata is supported.
                    data.business_qr_url.endsWith("/business-qr-971a63f59366fb3c.jpg") ? <svg viewBox="250 716 682 682" role="img" aria-label="支付宝经营码" className="block size-full overflow-hidden"><image href={data.business_qr_url} width="1182" height="1772" onError={() => setQrImageFailed(true)} /></svg> : <img src={data.business_qr_url} alt="支付宝经营码" className="max-h-[280px] max-w-full object-contain" onError={() => setQrImageFailed(true)} />
                  ) : generatedQr ? <img src={generatedQr} alt="支付宝转账二维码" className="size-full object-contain" onError={() => setQrImageFailed(true)} /> : <Loading label="正在生成二维码" />}
                </div>
                <p className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-[#0758ce]"><ScanLine className="size-4" aria-hidden="true" />打开支付宝 · 扫一扫</p>
                <p className="mt-2 text-center text-xs leading-5 text-slate-600">手机浏览可截屏，在支付宝扫一扫中从相册选择。</p>
                {data.collection_mode === "transfer" && data.payment_uri ? <Button className="mt-4 h-12 w-full rounded-2xl bg-[#0758ce] text-white hover:bg-[#0648a9] md:hidden" asChild><a href={data.payment_uri}>打开支付宝付款<ExternalLink /></a></Button> : null}
                <div className="mt-5 rounded-[18px] bg-[#fff8e9] px-4 py-3.5 text-sm leading-6 text-amber-950">{data.collection_mode === "business_qr" ? <>此二维码需手动输入金额：<strong className="whitespace-nowrap tabular-nums">¥{data.payable_money}</strong>。<br /><span className="text-xs">请勿取整或少付，输入后核对支付宝确认页再付款。</span></> : <p className="break-all">转账备注请保留 <strong>{data.out_trade_no}</strong>，以便确认本单付款。</p>}</div>
                </> : confirmation.canPay ? <div className="mt-5 rounded-[18px] border border-[#e6ebf4] bg-slate-50 p-5 text-center"><p className="text-sm leading-6 text-slate-600">确认实际应付金额后，显示付款码。</p><button type="button" ref={confirmTrigger} className="mt-4 min-h-12 w-full rounded-2xl bg-[#0758ce] px-3 py-3 font-medium text-white hover:bg-[#0648a9]" onClick={() => setDismissedKey("")}>核对金额并继续</button></div> : !checkoutExpired ? <p role="status" className="mt-5 text-sm text-red-800">当前订单暂不可付款，请刷新页面核对状态。</p> : null}
                {checkoutExpired ? <div role="status" className="mt-4 flex gap-2 rounded-[18px] border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>付款时间已过，请勿继续付款。已付款请等待确认，系统将持续确认至 {formatDate(data.monitor_until)}；尚未付款请返回商户重新下单。</p></div> : null}
              </div>
            </CardContent>
          </Card>

          <aside className="min-w-0 space-y-5">
            {confirmation.canPay ? <Card className="rounded-[24px] border-[#e6ebf4] bg-white shadow-[0_10px_30px_-18px_rgba(24,34,59,0.16)]"><CardContent className="p-5 sm:p-6"><h2 className="text-[15px] font-semibold tracking-tight">付款只需三步</h2><ol className="mt-2 divide-y divide-[#e6ebf4]">{[
              ["打开支付宝扫码", "使用支付宝扫一扫，识别页面中的二维码。"],
              ["核对金额后付款", data.collection_mode === "business_qr" ? `输入本单应付 ¥${data.payable_money}，以支付宝确认页显示金额为准。` : "核对支付宝页面显示的金额，并保留转账备注。"],
              ["返回此页等待确认", "付款后订单将自动更新，请勿重复支付。"],
            ].map(([title, description], index) => <li key={title} className="flex gap-3 py-4 last:pb-0"><span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#eef5ff] text-[13px] font-semibold text-[#0758ce]">{index + 1}</span><div><h3 className="text-sm font-medium leading-6">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{description}</p></div></li>)}</ol></CardContent></Card> : null}
            <Card className="rounded-[24px] border-[#e6ebf4] bg-white shadow-[0_10px_30px_-18px_rgba(24,34,59,0.16)]"><CardContent className="p-5 sm:p-6"><h2 className="text-[15px] font-semibold tracking-tight">订单信息</h2><dl className="mt-3 divide-y divide-[#e6ebf4]"><div className="flex items-center justify-between gap-3 py-3.5 text-sm"><dt className="text-slate-600">支付方式</dt><dd className="font-medium text-[#0758ce]">支付宝</dd></div><div className="py-3.5"><dt className="text-xs text-slate-600">商户订单号</dt><dd className="mt-1.5 break-all text-[13px] leading-5 tabular-nums">{data.out_trade_no}</dd></div><div className="py-3.5 last:pb-0"><dt className="text-xs text-slate-600">平台订单号</dt><dd className="mt-1.5 break-all text-[13px] leading-5 tabular-nums">{data.trade_no}</dd></div><div className="py-3.5 last:pb-0"><dt className="text-xs text-slate-600">创建时间</dt><dd className="mt-1.5 text-xs tabular-nums">{formatDate(data.created_at)}</dd></div></dl></CardContent></Card>
            <p role="status" className="flex items-start gap-2 px-1 text-xs leading-5 text-slate-600"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#0758ce]" aria-hidden="true" /><span>支付结果以系统到账确认为准。<br />已付款但未更新时，请稍候，勿再次付款。</span></p>
          </aside>
        </div>
        <footer className="mt-7 text-center text-xs text-slate-500">AliMPay · 订单收银台</footer>
      </div>
    </main>
  );
}
