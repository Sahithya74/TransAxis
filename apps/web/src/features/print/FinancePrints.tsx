import { useParams } from 'react-router';
import { fmtDate, fmtMoney, inrInWords, titleCase } from '../../lib/format';
import { useOrgProfile } from '../../lib/useOrgProfile';
import { useInvoice, useSettlement } from '../finance/api';
import { GST_MODE_LABEL, PAYMENT_MODE_LABEL } from '../finance/labels';
import { Box, Letterhead, PrintShell, Sign } from './PrintPages';

const th = '[&>th]:border [&>th]:border-black [&>th]:px-2 [&>th]:py-1 [&>th]:text-[10px] [&>th]:uppercase';
const td = '[&>td]:border [&>td]:border-black [&>td]:px-2 [&>td]:py-1';

export function InvoicePrint() {
  const id = Number(useParams().id);
  const inv = useInvoice(id).data;
  const org = useOrgProfile().data;
  const rcm = inv?.gstMode === 'rcm_5';
  return (
    <PrintShell title={`Tax invoice ${inv?.invoiceNo ?? ''}`} ready={!!inv}>
      {inv && (
        <>
          <Letterhead docTitle={inv.status === 'cancelled' ? 'Tax invoice (cancelled)' : 'Tax invoice'} number={inv.invoiceNo} date={fmtDate(inv.invoiceDate)} />
          <div className="grid grid-cols-2 gap-2">
            <Box label="Bill to">
              <div className="font-semibold">{inv.customer.name}</div>
              {inv.customer.billingAddress && <div>{inv.customer.billingAddress}</div>}
              <div>{[inv.customer.city, inv.customer.state].filter(Boolean).join(', ')}</div>
              <div>GSTIN {inv.customer.gstin ?? 'Unregistered'}</div>
            </Box>
            <div className="grid grid-cols-2 gap-2">
              <Box label="Due date">{fmtDate(inv.dueDate)}</Box>
              <Box label="Place of supply">{inv.placeOfSupply ?? '—'}</Box>
              <Box label="Service">Goods transport agency, SAC 9965</Box>
              <Box label="Tax payable on reverse charge">{rcm ? 'Yes' : 'No'}</Box>
            </div>
          </div>
          <table className="mt-3 w-full border-collapse text-left">
            <thead>
              <tr className={th}>
                <th>#</th>
                <th>Description</th>
                <th>SAC</th>
                <th className="text-right">Taxable value</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={l.id} className={td}>
                  <td>{i + 1}</td>
                  <td>{l.description}</td>
                  <td>{l.sac}</td>
                  <td className="text-right">{fmtMoney(l.amount, true)}</td>
                </tr>
              ))}
              <tr className={`font-semibold ${td}`}>
                <td colSpan={3}>Taxable value</td>
                <td className="text-right">{fmtMoney(inv.taxable, true)}</td>
              </tr>
              {rcm ? (
                <tr className={td}>
                  <td colSpan={3}>GST at 5%, payable by the recipient under reverse charge (not charged on this invoice)</td>
                  <td className="text-right">{fmtMoney(inv.reverseChargeTax, true)}</td>
                </tr>
              ) : inv.intraState ? (
                <>
                  <tr className={td}>
                    <td colSpan={3}>CGST</td>
                    <td className="text-right">{fmtMoney(inv.cgst, true)}</td>
                  </tr>
                  <tr className={td}>
                    <td colSpan={3}>SGST</td>
                    <td className="text-right">{fmtMoney(inv.sgst, true)}</td>
                  </tr>
                </>
              ) : (
                <tr className={td}>
                  <td colSpan={3}>IGST</td>
                  <td className="text-right">{fmtMoney(inv.igst, true)}</td>
                </tr>
              )}
              <tr className={`text-[13px] font-bold ${td}`}>
                <td colSpan={3}>Invoice total</td>
                <td className="text-right">{fmtMoney(inv.total, true)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2"><span className="font-semibold">Amount in words:</span> {inrInWords(inv.total)}</p>
          <p className="mt-1 text-[11px]">GST treatment: {GST_MODE_LABEL[inv.gstMode]}.</p>
          {inv.notes && <Box label="Notes" className="mt-2">{inv.notes}</Box>}
          <div className="mt-6 grid grid-cols-2 gap-2">
            <p className="text-[10px] text-neutral-600">
              Please quote the invoice number with your payment. If you deduct TDS, send the certificate so it can be matched to this invoice. This is a computer-generated invoice.
            </p>
            <Sign label={`For ${org?.legalName ?? org?.name ?? ''}: authorised signatory`} />
          </div>
        </>
      )}
    </PrintShell>
  );
}

export function PayslipPrint() {
  const id = Number(useParams().id);
  const s = useSettlement(id).data;
  const sum = (rows: { amount: string }[]) => rows.reduce((t, r) => t + Number(r.amount), 0);
  return (
    <PrintShell title={`Pay statement ${s?.settlementNo ?? ''}`} ready={!!s}>
      {s && (
        <>
          <Letterhead docTitle="Pay statement" number={s.settlementNo ?? ''} date={`${fmtDate(s.periodFrom)} to ${fmtDate(s.periodTo)}`} />
          <div className="grid grid-cols-3 gap-2">
            <Box label="Name">{s.worker.fullName}</Box>
            <Box label="Employee code">{s.worker.employeeCode}</Box>
            <Box label="Status">
              {s.status === 'paid'
                ? `Paid ${fmtDate(s.paidOn)}${s.paidMode ? ` by ${PAYMENT_MODE_LABEL[s.paidMode]}` : ''}${s.paymentReference ? `, ref ${s.paymentReference}` : ''}`
                : titleCase(s.status)}
            </Box>
          </div>
          <table className="mt-3 w-full border-collapse text-left">
            <thead>
              <tr className={th}>
                <th>Item</th>
                <th>How it was worked out</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.breakdown.earnings.map((e) => (
                <tr key={`e${e.id}`} className={td}>
                  <td>{e.label}{e.tripNo ? ` · ${e.tripNo}` : ''}</td>
                  <td>{e.formula}</td>
                  <td className="text-right">{fmtMoney(e.amount, true)}</td>
                </tr>
              ))}
              {s.breakdown.reimbursements.map((r) => (
                <tr key={`r${r.id}`} className={td}>
                  <td>Reimbursement · {fmtDate(r.date)}</td>
                  <td>{r.description}</td>
                  <td className="text-right">{fmtMoney(r.amount, true)}</td>
                </tr>
              ))}
              <tr className={`font-semibold ${td}`}>
                <td colSpan={2}>Earnings and reimbursements</td>
                <td className="text-right">{fmtMoney(sum(s.breakdown.earnings) + sum(s.breakdown.reimbursements), true)}</td>
              </tr>
              {s.breakdown.deductions.map((d) => (
                <tr key={`d${d.id}`} className={td}>
                  <td>Deduction</td>
                  <td>{d.reason}</td>
                  <td className="text-right">− {fmtMoney(d.amount, true)}</td>
                </tr>
              ))}
              {s.breakdown.advances
                .filter((a) => Number(a.recoveredNow) > 0)
                .map((a) => (
                  <tr key={`a${a.id}`} className={td}>
                    <td>Advance recovered</td>
                    <td>Advance given {fmtDate(a.givenOn)}</td>
                    <td className="text-right">− {fmtMoney(a.recoveredNow, true)}</td>
                  </tr>
                ))}
              <tr className={`text-[13px] font-bold ${td}`}>
                <td colSpan={2}>Net pay</td>
                <td className="text-right">{fmtMoney(s.net, true)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2"><span className="font-semibold">In words:</span> {inrInWords(s.net)}</p>
          {Number(s.advanceCarriedForward) > 0 && <p className="mt-1">Advance still to be recovered from later pay: {fmtMoney(s.advanceCarriedForward, true)}.</p>}
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Sign label="Received by" />
            <Sign label="For the company" />
          </div>
        </>
      )}
    </PrintShell>
  );
}
