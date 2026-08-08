# The RFP process, as your Apps Script actually runs it

Read out of the live project (`E88 Ventures`, `Code.gs` and `E88VI_Console_API.gs`,
last modified 07 Aug 2026), not from the specification PDF. Where the two disagree,
this document follows the code, because the code is what your people are using.

## 1. The chain

```
Requested  ->  Dept Head  ->  Finance  ->  [ MANCOM ]  ->  CEO  ->  MNC Dispatch  ->  Proof of Payment  ->  Done
                                             only if
                                          amount >= 500,000
```

From `E88VI_Console_API.gs`:

```js
var E88C_STAGES = ['Dept Head', 'Finance', 'CEO'];
var E88C_MANCOM_MIN = 500000;
var E88C_STAGE_RANK = { 'Requested':0, 'Draft':0, 'Dept Head':1, 'Finance':2,
                        'MANCOM':3, 'CEO':4, 'MNC Dispatch':5,
                        'Proof of Payment':6, 'Done':7 };
```

MANCOM is not a fixed stage in the list. It is injected between Finance and CEO
at the moment Finance approves, and only when the amount reaches 500,000:

```js
if (stage === 'Finance' && e88cNeedsMancom_(r) && !r.mancomCleared) {
  r.stage = 'MANCOM'; r.status = 'Pending';
  ... 'High-value request routed to MANCOM review before CEO release.'
}
```

Once MANCOM clears it, `mancomCleared` is set and the request goes to the CEO.

## 2. What happens after the CEO signs

This is the part that does not exist in Blitz yet. CEO approval does not mean
paid. The request goes **back to Finance** at a stage called `MNC Dispatch`,
where Finance composes an email to Monde Nissin carrying the signed RFP and
its attachments:

```js
// Final approval (CEO): route back to Finance to compose & dispatch the
// signed RFP to MNC.
r.stage = 'MNC Dispatch'; r.status = 'Pending';
```

Then `Proof of Payment`, then `Done`. So the last three steps of your live
process are a dispatch, a proof, and a close, and only the middle one has an
equivalent in Blitz today.

## 3. The rules the script enforces on every approval

- **An e-signature is mandatory.** Drawn or typed, and the drawn one is stored
  as a PNG data URL against the signer: `'Please draw or type your signature
  before approving.'`
- **The requestor cannot approve.** Checked against the signed-in Google
  identity, not against a field on the form.
- **Nobody signs two gates.** `sodViolation_()` walks `['deptHead','finance','ceo']`
  and refuses if one email appears twice.
- **You sign as yourself.** `approvalAuthz_()` compares the Google account of
  the caller with the email being claimed, and refuses a signature on somebody
  else's behalf.
- **A return needs a reason.** `'Please enter remarks explaining why the request
  is being returned.'` The request goes back to the requestor as `Returned`.
- **Stale links are rejected.** If the request has moved on, the approval page
  answers `'This request has moved to the "<stage>" stage.'`

## 4. Numbering

`RFP-<3-letter department><year>-<4 digits>`, for example `RFP-OPS2026-0069`.
The department code comes from the cost centre first and the division second,
through a fixed map: Operations and Supply Chain both give `OPS`, HR Admin gives
`HRA`, Finance and Accounting both give `FIN`, and so on.

## 5. Email routing

Each stage mails the next one, and the CEO's approval mails Finance rather than
the requestor:

| Just approved | Who gets the mail |
|---|---|
| submitted | the department head of that department, falling back to the catch-all head |
| deptHead | Finance |
| finance | the CEO, excluding anyone who also holds Finance |
| ceo | Finance, asked to forward it to Monde Nissin |
| paid | the requestor |

## 6. Where Blitz differs today

| | Live Apps Script | Blitz ERP (R63) | Decision needed |
|---|---|---|---|
| Approval gates | 4: Dept Head, Finance, MANCOM, CEO | 5: Department, Finance Check, Finance, MANCOM, Final | Yes. Blitz splits Finance into a checker and a head so Rucel can check without releasing. The live script has one Finance gate. |
| MANCOM threshold | 500,000 | 100,000 | Yes, if the tier is turned on. |
| MANCOM tier | always on | switched **off** (`rfp_mancom_enabled='0'`) | Yes. It was disabled because MANCOM discuss high-value spend before it reaches the system. |
| MNC Dispatch | a stage, with its own email to Monde Nissin | not modelled | Yes. This is the largest gap. |
| Proof of payment | a stage, before Done | an upload against a paid request, gated on approval | Close enough, but the stage name and the sequence differ. |
| E-signature | mandatory, drawn or typed | mandatory, drawn or typed | Aligned. |
| Segregation of duties | requestor blocked, no double signing | requestor blocked, no double signing | Aligned. |
| Return with reason | mandatory remarks, back to requestor | mandatory reason, chain restarts at Department | Aligned. |
| Numbering | `RFP-OPS2026-0069` | `RFP-OPS2026-0069` | Aligned. |

## 7. What I would change, and what I would leave

**Change:** add `MNC_DISPATCH` between final approval and payment preparation,
with the same email Finance sends today, so the ERP stops pretending a
CEO-approved request is ready to pay. Set `mancom_min` to 500,000 so the number
is right whenever the tier is switched back on.

**Leave:** the Finance Check gate. Splitting the checker from the head is a
control the Apps Script does not have, and losing it to match a script would be
a step backwards. If you want them merged, that should be a decision about who
releases money, not about matching a file.

**Ask:** whether MANCOM should be switched on in Blitz at all. Today it is off
by design, and if MANCOM keep meeting before the request is raised, off is
correct and the threshold is academic.
