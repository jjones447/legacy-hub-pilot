# Beyond Resources preview: arrangement and customer approval list

Based on reviewed PR374 755b99a6334fcbaeb55517ec7bbfccf5007282f4. This is a separate stacked draft preview; no merge/deploy to production or content-store change. Reconcile if374 or371 moves. Existing374 Membership/form/portal, support/Dec9/faith/routing and program information preserved.

## Proposed Home arrangement for customer decision

1. Existing hero/headline/lede/actions intact.
2. Exact revised Beyond Resources heading, five paragraphs and closing line, then exact three-step wording. Reuses the journey area's place near the top; the problem comes before individual programs.
3. Existing support tiles with all three exact371 approved descriptions.
4. Entire existing Caregiver Support Rooted in Community model text/link, moved after the tiles rather than another introductory block before programs.
5. Native expandable “More about the caregiving journey” panel preserves the prior journey heading and both exact371 approved paragraphs intact. Collapsing this supplementary text is a proposed arrangement, not customer-approved omission. It remains readable without JavaScript; no program is deleted.
6. Remaining community/impact/partner/event/resource information unchanged.

All371 copy remains intact, including its Our Model wellness sentence. Source-only preview uses the two approved journey paragraphs as static template text; it does not alter the governed D1 store or include371's Functions adapter. New Beyond Resources copy is static, without content selectors. Existing selectors on unrelated content remain. This avoids claiming the blocked371 Staff publishing path has been solved; actual production override behavior still needs qualification before any release.

## Complete sentence-change disclosure: four new drafts and one approved carry-forward

About, inside the existing Story description after its original paragraphs (none removed):

- We work alongside caregivers to turn a need for help into practical support, building relationships as we get to know each family's journey.
- We already track participation in our services and are strengthening how we understand caregiver outcomes; our new portal will help us build on that work.

Partnership, above the existing cards in Partner With Legacy:

- Healthcare providers, community organizations, and other agencies can work with Legacy to help families move from a referral to taking part in practical caregiver support.
- We provide many services directly, stay connected with caregivers, and track participation while strengthening how we understand outcomes.

### Fifth sentence in the delta: previously approved #371 copy, not a new draft

“We recognize the emotional toll caregiving can take and create opportunities that support mental well-being, reduce isolation, and help caregivers reconnect with themselves.”

Location: Our Model → Wellness & Restoration, `.om-area-4`, immediately after its existing description; source `templates/our-model.html.j2`, generated `our-model.html`. This sentence is newly present relative to the374 base, so it belongs in the complete change disclosure even though it is not newly authored for this task.

Provenance verified against #371 exact head `3054971e233555f3a38c61a462b76dcf206d6502`: same sentence and placement, with independent APPROVED review at that head. It is the requester's verbatim earlier well-being request (Nov17), and requester approval of that exact #371 preview was recorded Nov18. #371 remains OPEN/unpublished because its separate governed-content publication path is blocked; prior wording approval is not an installed/live claim or publication authority here.

This carry-forward is OUTSIDE the new About/partnership drafting scope. It is retained solely because the current preview order explicitly requires preserving all #371-approved wording. The four sentences above are the newly drafted reinforcement requiring approval; this fifth sentence is an explicitly disclosed prior-approved carry-forward. Customer approval of this preview's arrangement and new drafts remains pending. Earlier author handoff claimed only four drafted sentences and noted #371 preservation but did not enumerate this fifth change; this section corrects that incomplete disclosure without changing source or erasing history.

The “More about the caregiving journey” summary label is also drafted arrangement text. Homepage requested paragraphs/steps and Community & Corporate card are not paraphrased. No exclusivity, measured outcome results or guaranteed service claim. Hands-on caregiver coaching appears only in requested copy, with no removed coaching link.

## Evidence boundaries

Static preview package only, no Functions/API/mail; fictional/no-send banner and CSP connect-src none/form-action none. Existing forms are preserved for source parity but cannot submit in this preview. No private record read, schema, profile, newsletter or journaling implementation. Screenshot/pixel desktop/mobile and full-browser navigation evidence are not supplied unless separately attributed; scoped Home CSS retains brand and changes three-step grid to one column on narrow screens. Independent source review and customer approval remain required; this is not production readiness.

PR integration note: the branch is stacked on unmerged374, but the review PR targets main so the repository's required main-targeted CI can run. The full diff therefore includes374; the new-task delta is against755b99a6. Do not merge the inherited stack or treat374's customer final look as complete through this draft.
