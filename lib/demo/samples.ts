/**
 * Sample bank statement files of the demo instance, generated on the fly for
 * each demo company to show off the statement import (KLEDG_DEMO_MODE only).
 *
 * A sample covers the four weeks before today and mixes two kinds of lines:
 *   - operations already on the company's bank account (the simulated Qonto
 *     history that the seed synced), rewritten with the wording another bank
 *     export would use, so the import shows them as probable duplicates;
 *   - new operations drawn from the same company profile with another seed,
 *     so they look like the company's usual activity without existing yet.
 * The output only depends on the company and the day: no database access.
 * The account number written in OFX and camt.053 files is the demo account's,
 * so the import does not warn about another account.
 */

import { addDays, DemoProfileEngine, type DemoTransaction } from './qonto/engine'
import { DEMO_PROFILES, type DemoBankProfile } from './qonto/profiles'
import { stripSandboxSuffix } from './sandbox/identity'

export const SAMPLE_FORMATS = ['csv', 'ofx', 'camt053', 'boursobank'] as const
export type SampleFormat = (typeof SAMPLE_FORMATS)[number]

export interface SampleFileInfo {
  format: SampleFormat
  fileName: string
  label: string
  badge: string
  mimeType: string
}

export interface SampleLine {
  date: string
  /** Signed amount in cents. */
  cents: number
  label: string
  counterparty: string
  /** Stable id of the line in the sample (FITID, AcctSvcrRef). */
  id: string
  /** True when the operation is already on the account (a probable duplicate on import). */
  existing: boolean
}

export interface SampleFile extends SampleFileInfo {
  content: string
}

/** How many lines of each kind a sample holds at most. */
const PER_KIND = 5
const WINDOW_DAYS = 28

/**
 * Bank profile of a demo company from its slug, with or without the sandbox
 * suffix ("atelier-lumen" and "atelier-lumen-k3x9ab" both give Atelier Lumen).
 */
export function demoProfileOf(slug: string): DemoBankProfile | undefined {
  const base = stripSandboxSuffix(slug)
  return DEMO_PROFILES.find((p) => p.engine.slug === slug) ?? DEMO_PROFILES.find((p) => p.engine.slug === base)
}

export function sampleFileInfo(format: SampleFormat, slug: string, today: string): SampleFileInfo {
  const stamp = today.replace(/-/g, '')
  switch (format) {
    case 'csv':
      return { format, fileName: `releve-${slug}-${stamp}.csv`, label: 'Relevé CSV', badge: 'CSV', mimeType: 'text/csv' }
    case 'ofx':
      return { format, fileName: `releve-${slug}-${stamp}.ofx`, label: 'Relevé OFX', badge: 'OFX', mimeType: 'application/x-ofx' }
    case 'camt053':
      return { format, fileName: `releve-${slug}-${stamp}-camt053.xml`, label: 'Relevé camt.053', badge: 'XML', mimeType: 'application/xml' }
    case 'boursobank':
      return { format, fileName: `export-boursobank-${slug}-${stamp}.csv`, label: 'Export BoursoBank', badge: 'CSV', mimeType: 'text/csv' }
  }
}

const cents = (t: DemoTransaction) => Math.round(t.amount * 100) * (t.side === 'debit' ? -1 : 1)

const upper = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9/ .-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The wording a traditional bank export uses for the same operation. */
function bankWording(t: DemoTransaction): string {
  const party = upper(t.counterparty)
  switch (t.operationType) {
    case 'card':
      return `PAIEMENT PAR CARTE ${t.date.slice(8, 10)}/${t.date.slice(5, 7)} ${party}`
    case 'direct_debit':
      return `PRELEVEMENT EUROPEEN ${party}`
    case 'income':
      return `VIREMENT RECU ${party}`
    case 'qonto_fee':
      return `FRAIS ${upper(t.label)}`
    default:
      return t.side === 'credit' ? `VIREMENT RECU ${party}` : `VIREMENT EMIS ${party}`
  }
}

/** Fallback operations for profiles too quiet to draw enough new ones. */
const FALLBACK: Array<{ day: number; cents: number; label: string; counterparty: string }> = [
  { day: 3, cents: -800, label: "COMMISSION D'INTERVENTION", counterparty: 'Banque' },
  { day: 9, cents: -2490, label: 'PAIEMENT PAR CARTE PAPETERIE DU CENTRE', counterparty: 'Papeterie du Centre' },
  { day: 16, cents: 4500, label: 'VIREMENT RECU REMBOURSEMENT TROP PERCU', counterparty: 'Remboursement' },
]

/** Lines of the sample of a company for a day (YYYY-MM-DD), oldest first. */
export function sampleLines(profile: DemoBankProfile, today: string): SampleLine[] {
  const from = addDays(today, -WINDOW_DAYS)
  const to = addDays(today, -1)
  const slug = profile.engine.slug
  const real = profile.engine.transactions(from, to)

  const existing: SampleLine[] = real.slice(-PER_KIND).map((t) => ({
    date: t.date,
    cents: cents(t),
    label: bankWording(t),
    counterparty: t.counterparty,
    id: '',
    existing: true,
  }))

  // Same profile, another seed: the scheduled operations come out identical
  // (same labels), the random ones differ. Keep only what is not on the account.
  const realKeys = new Set(real.map((t) => `${t.date}|${cents(t)}`))
  const realLabels = new Set(real.map((t) => t.label))
  const fresh: SampleLine[] = []
  for (const variant of ['samples', 'samples-2', 'samples-3']) {
    if (fresh.length >= PER_KIND) break
    const engine = new DemoProfileEngine({ ...profile.engine.spec, seed: `${profile.engine.spec.seed}:${variant}:${today}` })
    for (const t of engine.transactions(from, to).reverse()) {
      if (fresh.length >= PER_KIND) break
      const key = `${t.date}|${cents(t)}`
      if (realKeys.has(key) || realLabels.has(t.label) || fresh.some((f) => `${f.date}|${f.cents}` === key)) continue
      fresh.push({ date: t.date, cents: cents(t), label: bankWording(t), counterparty: t.counterparty, id: '', existing: false })
    }
  }
  for (const f of FALLBACK) {
    if (fresh.length >= 3) break
    const date = addDays(from, f.day)
    if (realKeys.has(`${date}|${f.cents}`)) continue
    fresh.push({ date, cents: f.cents, label: f.label, counterparty: f.counterparty, id: '', existing: false })
  }

  return [...existing, ...fresh]
    .sort((a, b) => a.date.localeCompare(b.date) || a.cents - b.cents || a.label.localeCompare(b.label))
    .map((line, i) => ({ ...line, id: `${slug.toUpperCase().replace(/-/g, '')}-${line.date.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}` }))
}

const frAmount = (abs: number) => {
  const units = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${units},${String(abs % 100).padStart(2, '0')}`
}
const dotAmount = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`
const frDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** RIB parts of a French IBAN: bank code, branch code, account number. */
function ribOf(iban: string) {
  return { bank: iban.slice(4, 9), branch: iban.slice(9, 14), account: iban.slice(14, 25) }
}

function csv(lines: SampleLine[]): string {
  const rows = lines.map((l) => {
    const debit = l.cents < 0 ? frAmount(-l.cents) : ''
    const credit = l.cents > 0 ? frAmount(l.cents) : ''
    return [frDate(l.date), frDate(l.date), l.label, l.id, debit, credit].join(';')
  })
  return ['Date;Date de valeur;Libellé;Référence;Débit;Crédit', ...rows].join('\r\n') + '\r\n'
}

function boursobank(lines: SampleLine[], profile: DemoBankProfile): string {
  const { account } = ribOf(profile.bankAccount.iban)
  const header = 'dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance'
  const rows = lines.map((l) =>
    [
      l.date,
      l.date,
      `"${l.label}"`,
      `"${l.cents < 0 ? 'Dépenses professionnelles' : 'Encaissements'}"`,
      `"${l.cents < 0 ? 'Dépenses' : 'Revenus'}"`,
      `"${l.counterparty.toLowerCase()}"`,
      `"${l.cents < 0 ? '-' : ''}${frAmount(Math.abs(l.cents))}"`,
      '""',
      `"${account}"`,
      '"Compte professionnel"',
      '',
    ].join(';'),
  )
  return '﻿' + [header, ...rows].join('\n') + '\n'
}

function ofx(lines: SampleLine[], profile: DemoBankProfile, today: string): string {
  const { bank, branch, account } = ribOf(profile.bankAccount.iban)
  const compact = (d: string) => d.replace(/-/g, '')
  const trns = lines
    .map(
      (l) => `          <STMTTRN>
            <TRNTYPE>${l.cents < 0 ? 'DEBIT' : 'CREDIT'}</TRNTYPE>
            <DTPOSTED>${compact(l.date)}</DTPOSTED>
            <TRNAMT>${dotAmount(l.cents)}</TRNAMT>
            <FITID>${l.id}</FITID>
            <NAME>${xml(l.label.slice(0, 32))}</NAME>
            <MEMO>${xml(l.label)}</MEMO>
          </STMTTRN>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <DTSERVER>${compact(today)}060000</DTSERVER>
      <LANGUAGE>FRA</LANGUAGE>
    </SONRS>
  </SIGNONMSGSRSV1>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>1</TRNUID>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <STMTRS>
        <CURDEF>EUR</CURDEF>
        <BANKACCTFROM>
          <BANKID>${bank}</BANKID>
          <BRANCHID>${branch}</BRANCHID>
          <ACCTID>${account}</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>${compact(lines[0]?.date ?? today)}</DTSTART>
          <DTEND>${compact(lines[lines.length - 1]?.date ?? today)}</DTEND>
${trns}
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`
}

function camt053(lines: SampleLine[], profile: DemoBankProfile, today: string): string {
  const entries = lines
    .map(
      (l) => `      <Ntry>
        <Amt Ccy="EUR">${dotAmount(Math.abs(l.cents))}</Amt>
        <CdtDbtInd>${l.cents < 0 ? 'DBIT' : 'CRDT'}</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>${l.date}</Dt></BookgDt>
        <ValDt><Dt>${l.date}</Dt></ValDt>
        <AcctSvcrRef>${l.id}</AcctSvcrRef>
        <AddtlNtryInf>${xml(l.label)}</AddtlNtryInf>
        <NtryDtls><TxDtls>
          <RltdPties><${l.cents < 0 ? 'Cdtr' : 'Dbtr'}><Nm>${xml(l.counterparty)}</Nm></${l.cents < 0 ? 'Cdtr' : 'Dbtr'}></RltdPties>
        </TxDtls></NtryDtls>
      </Ntry>`,
    )
    .join('\n')
  const id = `${profile.engine.slug.toUpperCase()}-${today.replace(/-/g, '')}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>${id}</MsgId>
      <CreDtTm>${today}T06:00:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>${id}</Id>
      <CreDtTm>${today}T06:00:00</CreDtTm>
      <Acct>
        <Id><IBAN>${profile.bankAccount.iban}</IBAN></Id>
        <Ccy>EUR</Ccy>
      </Acct>
${entries}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`
}

/** The sample file of a company in a format, for a day (YYYY-MM-DD). */
export function buildSampleFile(profile: DemoBankProfile, format: SampleFormat, today: string): SampleFile {
  const lines = sampleLines(profile, today)
  const info = sampleFileInfo(format, profile.engine.slug, today)
  const content =
    format === 'csv'
      ? csv(lines)
      : format === 'boursobank'
        ? boursobank(lines, profile)
        : format === 'ofx'
          ? ofx(lines, profile, today)
          : camt053(lines, profile, today)
  return { ...info, content }
}
