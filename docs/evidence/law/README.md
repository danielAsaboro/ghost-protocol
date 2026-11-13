# Probate law and GhostProtocol

What US law asks for before a dead person's digital assets are released or distributed, what the QuadrigaCX court record shows happened when one person held every key, and where GhostProtocol meets or misses each requirement. Read from primary text only, on 2026-11-13. This is not legal advice.

## Sources

| # | Document | Type | Where it was read |
|---|---|---|---|
| R1 | Revised Uniform Fiduciary Access to Digital Assets Act (2015), final act with comments, ULC text dated March 8, 2016 | Model act | [uniformlaws.org](https://www.uniformlaws.org/HigherLogic/System/DownloadDocumentFile.ashx?DocumentFileKey=112ab648-b257-97f2-48c2-61fe109a0b33) (resolves to `2015_RUFADAA_Final with Technical Amendments3.pdf`; sha256 `502e891e3a7dd650…`) |
| R2 | Maine Probate Code, 18-C M.R.S. Article 10: RUFADAA as enacted (§§10-102, 10-104, 10-105, 10-107, 10-108, 10-115, 10-116) | Enacted statute | [legislature.maine.gov](https://legislature.maine.gov/statutes/18-C/title18-Csec10-104.html) (change the section in the URL) |
| U1 | Uniform Probate Code §1-107, evidence of death or status | Model act | ULC text is behind a login at [uniformlaws.org](https://www.uniformlaws.org/viewdocument/final-act-with-comments-135). Read as enacted in Maine (U2, §1-106) and checked against a [transcription of the ULC text](https://njwills.blogspot.com/2015/03/section-1-107-evidence-of-death-or.html); the six paragraphs match |
| U2 | Maine Probate Code, 18-C M.R.S. §§1-106, 1-201, 2-104, 2-502, 2-702, 3-302, 3-307, 3-1201, 6-101, 6-102: the 2019 UPC as enacted | Enacted statute | [§1-106](https://legislature.maine.gov/statutes/18-C/title18-Csec1-106.html), [§2-104](https://legislature.maine.gov/statutes/18-C/title18-Csec2-104.html), [§2-702](https://legislature.maine.gov/statutes/18-C/title18-Csec2-702.html), [§3-307](https://legislature.maine.gov/statutes/18-C/title18-Csec3-307.html), [§6-101](https://legislature.maine.gov/statutes/18-C/title18-Csec6-101.html), [§6-102](https://legislature.maine.gov/statutes/18-C/title18-Csec6-102.html) |
| U3 | Minnesota Statutes §§524.1-107, 524.2-104, 524.2-702: an older UPC enactment, for contrast | Enacted statute | [revisor.mn.gov](https://www.revisor.mn.gov/statutes/cite/524.2-104) |
| Q1 | Affidavit of Jennifer Robertson, sworn January 30, 2019, CCAA application, Supreme Court of Nova Scotia, Hfx No. 484742 | Court filing | [EY document centre](https://documentcentre.ey.com/api/ManageDoc/download?docId=26033&docVersionId=28487) (scanned; read by OCR and page images; sha256 `4c310eeb09c38845…`) |
| Q2 | First Report of the Monitor (Ernst & Young Inc.), February 12, 2019 | Court filing | [EY](https://documentcentre.ey.com/api/ManageDoc/download?docId=26002&docVersionId=35568) |
| Q3 | Third Report of the Monitor, March 1, 2019 | Court filing | [EY](https://documentcentre.ey.com/api/ManageDoc/download?docId=26006&docVersionId=35570) |
| Q4 | Fifth Report of the Monitor, June 19, 2019 | Court filing | [EY](https://documentcentre.ey.com/api/ManageDoc/download?docId=26011&docVersionId=35572) |
| Q5 | Order (Re: Transfer of Proceedings), Supreme Court of Nova Scotia in Bankruptcy, September 10, 2019 | Court order | [EY](https://documentcentre.ey.com/api/ManageDoc/download?docId=25944&docVersionId=35192) |
| Q6 | "QuadrigaCX: A Review by Staff of the Ontario Securities Commission", dated April 14, 2020, published June 2020 | Regulator report | [osc.ca](https://www.osc.ca/quadrigacxreport/web/files/QuadrigaCX-A-Review-by-Staff-of-the-Ontario-Securities-Commission.pdf) (sha256 `85016db23827f0e1…`) |
| Q7 | Representative Counsel (Miller Thomson LLP) to the RCMP, "Request for Exhumation and Post-Mortem Autopsy of Gerald Cotten", December 13, 2019 | Letter of counsel appointed by the court | [millerthomson.com](https://millerthomson.com/wp-content/uploads/2019/12/Cover-Letter-to-RCMP-Final.pdf) |

EY's case page is [ey.com/ca/quadriga](https://www.ey.com/ca/quadriga); it lists 175 filings. Statute text is quoted from the Maine enactments, which are public law; the ULC section number is given beside each. Court filings and the OSC report are paraphrased with paragraph or page numbers.

## 1. RUFADAA: what an executor must hand a custodian

**Scope.** RUFADAA is about access to records, not about who owns the money. The ULC comment to §2 says the act "does not affect the authority to engage in transfers of title" for funds held with a bank, broker or other custodian (R1 p. 7). §5(b) gives a fiduciary no rights beyond the user's own (R2 §10-105(2)).

**Definitions (§2).**
- Custodian, §2(8): "a person that carries, maintains, processes, receives or stores a digital asset of a user" (R2 §10-102(7)). "Person" (§2(17)) is an individual, estate, business, government or "other legal entity".
- Online tool, §2(16): "an electronic service provided by a custodian that allows a user", in an agreement distinct from the terms of service, to give directions for "disclosure or nondisclosure of digital assets to a 3rd person" (R2 §10-102(15)).
- Designated recipient, §2(9): the person a user picks through an online tool. The ULC comment says a designated recipient is not held to a fiduciary's standard of conduct (R1 p. 8).
- Digital asset, §2(10): an electronic record in which an individual has a right or interest, excluding an underlying asset "unless the asset or liability is itself an electronic record".
- User, §2(26): a person that has an account with a custodian; an account (§2(1)) exists under a terms-of-service agreement.

**Priority, §4.** An online tool beats a will only on one condition: §4(a) applies "If the online tool allows the user to modify or delete a direction at all times" (R2 §10-104(1)). Without an online tool, a will, trust or power of attorney governs (§4(b)); without either, the terms of service and then the act's defaults (R1 §4 comment).

**What the personal representative must provide.**

| Request | Must give | May be asked for |
|---|---|---|
| Content of communications, §7 | Written request; [certified] death certificate; [certified] letters of appointment, small-estate affidavit or court order; the will or other record of consent unless an online tool was used | Account identifier; evidence linking the account to the user; a court finding on the account, federal privacy law, consent, or necessity |
| Everything else (catalogue and other assets), §8 | Written request; death certificate; letters, small-estate affidavit or court order | Account identifier; evidence linking the account to the user; an affidavit that disclosure is "reasonably necessary for administration of the estate"; a court finding |
| Closing the account, §15(g) | Written request; death certificate; letters or court order | Account identifier; evidence linking the account; a court finding |

(R1 §§7, 8, 15(g); R2 §§10-107, 10-108, 10-115(7). Maine drops "small-estate affidavit" from its list.)

**Duties and limits, §15.** A fiduciary's authority over digital assets carries the duties of care, loyalty and confidentiality (§15(a)) and "May not be used to impersonate the user" (§15(b)(4)). Under §15(c) the fiduciary has a right to access any digital asset "not held by a custodian or subject to a terms of service agreement", which covers self-custodied keys.

**Custodian compliance, §16.** The custodian must comply within [60] days of receiving the documents; otherwise the fiduciary applies to court (§16(a)). The custodian may insist on a court order (§16(e)) and is immune "for an act or omission done in good faith in compliance with this Act" (§16(f); R2 §10-116(6)).

## 2. Proof of death and survival under the Uniform Probate Code

**UPC §1-107** (U1; Maine §1-106):
1. Death is defined by the Uniform Determination of Death Act.
2. A certified or authenticated death certificate from the place of death "is prima facie evidence of the fact, place, date and time of death".
3. A certified government record that a person is missing, detained, dead or alive is prima facie evidence of that status.
4. Without either, death "may be established by clear and convincing evidence, including circumstantial evidence".
5. Someone absent "for a continuous period of 5 years", not heard from, whose absence is "not satisfactorily explained after diligent search or inquiry" is presumed dead at the end of the period.
6. A certificate stating a time of death 120 or more hours after another's death proves survival by clear and convincing evidence, unless that time is disputed.

**120-hour survival.**
- §2-104 (intestacy): an heir must survive the decedent by 120 hours, shown by clear and convincing evidence, or is deemed to have predeceased (Maine §2-104(1)(A)).
- §2-702 (wills and other governing instruments): an individual "who has not been established by clear and convincing evidence to have survived" an event by 120 hours is deemed to have predeceased it (Maine §2-702(1), (2)). A governing instrument may set its own survival period, which must also be proved by clear and convincing evidence (§2-702(4)(B)). "Governing instrument" includes a POD account, a TOD security and any "dispositive, appointive or nominative instrument of any similar type" (Maine §1-201(21)).
- The register may not probate a will informally or appoint a personal representative until "at least 120 hours have elapsed since the decedent's death" (Maine §§3-302, 3-307(1)).
- States differ. Minnesota's §524.2-104 keeps 120 hours but has no clear-and-convincing standard, and its §524.2-702 only applies to devisees, revocable-trust beneficiaries, TOD deeds and powers of appointment (U3).

**Related rules a vault meets head-on.**
- Will execution, §2-502: a will needs two people who witnessed the testator's signature or acknowledgment, or a handwritten will. GhostProtocol's witnesses attest a death, not a signature.
- Nonprobate transfers, §6-101: a transfer on death under an account, custodial or similar written instrument "is nontestamentary", so will formalities do not apply. But "Nothing in this section limits the rights of creditors" (Maine §6-101(2)).
- Creditors, §6-102: a nonprobate transferee is liable to the estate for unpaid claims and family allowances, up to what they received. It covers transfers the decedent "had power, acting alone, to prevent … by revocation or withdrawal" (Maine §6-102(1)).
- Small estates, §3-1201: thirty days after a death, a holder of the decedent's personal property must deliver it to a successor who swears the estate is small, 30 days have passed, no representative is pending, and they are entitled to it.

## 3. QuadrigaCX: the court record on keys and access

**Courts.** The CCAA case was in the Supreme Court of Nova Scotia (Hfx No. 484742). EY was appointed Monitor on February 5, 2019, and the companies went into bankruptcy on April 15, 2019 with EY as trustee. On September 10, 2019 the bankruptcy was transferred to the Ontario Superior Court of Justice (Commercial List) (Q5 ¶¶2–3), where Justice Hainey heard later motions. The CCAA filings, including the monitor's reports and the affidavit, are Nova Scotia documents. The OSC report is a staff review; on p. 3 it says its findings have not been tested before the tribunal or a court.

**Proof of death was fast.** Cotten died in India on December 9, 2018. His widow's affidavit attaches a death certificate as Exhibit L (Q1 ¶51; the exhibit index lists a "Statement of Death" dated December 12, 2018, with the surname spelled "Cotton"). She was sole executor and the will was probated in Nova Scotia on January 2, 2019, 24 days after the death (Q1 ¶52).

**Formal proof did not settle the fact.** The same affidavit reports online speculation about whether he was really dead (Q1 ¶54). A year later, the court-appointed Representative Counsel asked the RCMP to exhume the body to confirm its identity and the cause of death, citing the questionable circumstances and the users' losses (Q7 p. 1).

**Keys at death.**
- The laptop he ran the business from was encrypted. His widow did not know the password or recovery key and could not find them written down (Q1 ¶62). He alone handled funds, coins, banking and accounting, and moved most coins to cold storage (Q1 ¶65). An expert tried to break into his computers; an encrypted USB key could not be opened (Q1 ¶66).
- EY took custody of 4 laptops, 4 phones and 3 fully encrypted USB keys, and kept them in a safety deposit box (Q2 ¶20). On February 6, 2019 Quadriga itself sent 103 BTC into cold wallets it could not open (Q2 ¶18).
- Three devices, including the large MacBook and his home computer, stayed encrypted and unread (Q4 ¶34). Passwords for fiat and crypto holdings were held by Cotten alone, and there was no procedure to pass them on if key personnel died (Q4 ¶10(d)).
- Retrieving his Gmail might take a US court order, according to Google (Q4 ¶38). This is the custodian-demands-an-order situation that RUFADAA §16(e) allows.

**Keys were not the main loss.**
- The six bitcoin cold wallets Quadriga named had been emptied in April 2018, eight months before the death (Q3 ¶46(a)), and the other candidate wallets held nothing (Q3 ¶48).
- OSC staff found that most of the $169 million shortfall came from Cotten's fraud, not lost keys: about $115 million from trading fake balances under aliases and $28 million lost trading on outside platforms (Q6 pp. 3, 25). Quadriga had told clients most coins were in cold storage. It mostly used hot wallets and other exchanges (Q6 p. 12).
- About $10 million in Ether was locked in 2017 by a coding error, not by the death (Q6 p. 20). At his death Cotten could not reach most of what EY later recovered (Q6 p. 24 n. 5).
- Part of the recovery came from the estate: EY recovered assets from Robertson expected to be worth $12 million (Q6 p. 25). The OSC's lessons for platforms include risk controls for "key personnel" (Q6 p. 29).

## Comparison

"Meets" means the mechanism supplies what the rule asks for, without anyone going to court. Parameters of the deployed test vault are from [deploy.txt](../live/deploy.txt) line 23: threshold 2, `inactivity_secs` 60, `grace_secs` 60, `override_grace_secs` 120, `contest_secs` 30, `freeze_max_secs` 60, `fallback_secs` 600, `legal_authority` `court.ghostprotocol-vault.testnet`.

| Requirement | Source | GhostProtocol | Gap |
|---|---|---|---|
| Certified death certificate | RUFADAA §§7(2), 8(2), 15(g)(1); UPC §1-107(2) | No | Witnesses sign `ghost:death:{vault}:{epoch}:{death_at}` with keys the owner chose. They are not sworn, not identified, and attach no record |
| Letters of appointment, small-estate affidavit or court order | RUFADAA §§7(3), 8(3) | No | No personal representative exists anywhere in the flow. Heirs are paid directly |
| Death shown by clear and convincing evidence when there is no certificate | UPC §1-107(4) | Partly | Silence plus a 2-of-3 quorum is circumstantial evidence a court could weigh. The contract takes it as conclusive, and nobody tests it |
| Presumed dead only after 5 years' unexplained absence and diligent search | UPC §1-107(5) | Partly (v3) | `abandon_secs` opens a claim with no witnesses after silence, but the owner sets the period (it need only exceed `inactivity_secs`) and nobody searches. Silence about a check-in is not absence |
| Heir must survive the decedent by 120 hours | UPC §§2-104, 2-702 | No | Nothing checks that an heir is alive. An heir who died with or before the owner is still paid to their address. `death_at` is whatever the witnesses sign |
| No informal probate or appointment within 120 hours of death | UPC §§3-302, 3-307 | Partly | Holds if `grace_secs` ≥ 432,000. It is 60 on the test vault. The override path waits `override_grace_secs`, also an owner choice |
| Will formalities: two witnesses to the signing | UPC §2-502 | No | The vault's best argument is the opposite: that it is a nontestamentary transfer under §6-101. Whether a contract config counts as a "written instrument of a similar nature" is open |
| Online tool overrides a contrary will | RUFADAA §4(a) | Not on its terms | See below: there is no custodian "person", and the heir list cannot be modified after deploy |
| Rights of creditors survive a transfer on death | UPC §§6-101(2), 6-102 | No | No hold for creditors, taxes or a spouse's share. Payment is final on Base. Recovery means suing each heir |
| Personal representative may access assets held by no custodian | RUFADAA §15(c) | Blocks it | The right exists on paper, but the vault has no key to hand over and no method an executor can call |
| A court can order compliance; the custodian is immune if it complies | RUFADAA §16(a), (e), (f) | Partly | `freeze` pauses one claim, once, for at most `freeze_max_secs` (60 s on the test vault). Only the NEAR account fixed at deploy can call it, and no court holds that key. No one can be held in contempt |
| Evidence linking the account to the user | RUFADAA §8(4)(B) | Yes | The owner, heirs, witnesses and amounts are public on-chain and fixed at deploy ([lib.rs](../../../contract/src/lib.rs) `new`, `get_state`) |
| No impersonating the user | RUFADAA §15(b)(4) | Yes | No one acts as the owner after death. Heirs receive transfers; the agent only picks an amount between floor and cap |
| Fiduciary duties of care, loyalty and confidentiality | RUFADAA §15(a) | No | Witnesses, the registrar and the AI agent are not fiduciaries. Heir list and amounts are public before death |

### Is the vault an "online tool" under §4?

Arguably not, on four separate grounds:

1. **No custodian.** An online tool must be provided by a custodian, and a custodian is a "person". After the lock, the NEAR contract has no key and no operator. A court might look for a person behind it. The MPC network "processes" signatures, but it offers the user no service or agreement. The deployer gave up control on purpose.
2. **No agreement.** The tool must be "an agreement distinct from the terms of service agreement". There are no terms of service and no account, so there is no "user" in the §2(26) sense.
3. **Transfers, not disclosure.** §4 directs "disclosure or nondisclosure of digital assets". The vault moves value. The ULC comment says the act leaves transfers of title alone.
4. **It fails the §4(a) condition even if it qualified.** The override applies only if the tool lets the user "modify or delete a direction at all times". GhostProtocol has no method that changes heirs, floors or caps after `new`, and none that lets the owner withdraw. A check-in delays the claim; it does not change the direction.

Only point 4 is under the project's control. Making heirs editable by the owner would meet §4(a)'s wording. It would also add the key that the threat model refuses, because a stolen editing key redirects the money.

## Objections a probate lawyer would raise

1. **"Two signatures are not proof of death."** A probate court starts from a certified certificate (UPC §1-107(2)). Without one it wants clear and convincing evidence, weighed by a judge (§1-107(4)). The vault takes two unsworn keys plus a missed check-in as final, and pays before anyone could contest in court. Quadriga shows the opposite problem too: a certificate and a probated will did not stop creditors from asking for an exhumation a year later (Q1 ¶¶51–54; Q7). Disputes about death are common, and the vault has no forum for them.
2. **"Is it a will or a lifetime transfer? Either answer costs you."** If it is testamentary, it lacks §2-502 formalities. If it is a nontestamentary transfer under §6-101, creditors keep their rights (§6-101(2)) and can recover from heirs (§6-102). And because the owner can neither revoke heirs nor withdraw funds, a court may call it a completed lifetime gift, with the tax and creditor consequences that follow. Those consequences were not researched here. Quadriga's creditors recovered about $12 million from the founder's side (Q6 p. 25); with a vault, that claim would chase the heirs one by one.
3. **"It is not an online tool, so the will still governs."** See the four grounds above. If a later will leaves the crypto elsewhere, the executor's position is that the vault balance was estate property. The heirs who were paid then hold money the estate can sue for.
4. **"Who did you pay, and were they alive?"** UPC §§2-104 and 2-702 deem an heir who did not survive by 120 hours to have predeceased, and the share passes elsewhere. The vault pays a fixed address whatever happened to its holder. Common disasters (owner and spouse in the same accident) and heirs whose keys died with them are exactly the cases the 120-hour rule exists for.
5. **"The court freeze is a courtesy, not jurisdiction."** Real orders are open-ended, renewable, and backed by contempt against a custodian (RUFADAA §16; Q4 ¶38 shows Google wanting a US order before releasing one email account). The vault offers one pause of fixed length, callable only by an account chosen at deploy. A court in a contested estate cannot stop a payout it learns about after `freeze_max_secs`, and cannot order the money back from the contract.

What the record supports in the vault's favour: Quadriga's key loss came from one person holding every password with no succession plan (Q4 ¶10(d)), and GhostProtocol removes that single point. But OSC staff found that lost keys were not where most of Quadriga's money went (Q6 pp. 3, 23). The design does nothing about an owner who misleads the people relying on him, which was Quadriga's actual failure.
