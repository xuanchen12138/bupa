# My Bupa Agent Presentation Plan

September 28, 2026 · @Sarah

## 0. Presentation Overview

The pitch is only **3 minutes, followed by 3 minutes of Q&A** (Team 4D, 16:30). Below is the full 12-slide version; Section 10 sets out what to keep for the 3-minute pitch. Build the full version as a slide deck, skip slides marked “optional” during the pitch, and return to them during Q&A.

**Narrative arc**: We are the users → discover the problem → define four problems → investigate the existing app and find that “the features are all there, but disconnected” → connect them → demonstrate two use cases → explain feasibility and business value. This follows the workflow of “discovering the problem → finding the answer,” which is exactly what the judges want to see in Show Your Work.

**The thread running through the whole pitch**: Bupa already has the data and the features. What's missing is the connection: an AI that turns what Bupa knows into things it does for you.

**User persona (use this one persona throughout)**

| Item | Details |
| --- | --- |
| Name | Lin, 24, an international student who has just arrived in Melbourne for a master's degree; in her third week of university |
| Insurance | Bupa OSHC, purchased to meet visa requirements; has never opened My Bupa |
| Background | Unfamiliar with Australia's healthcare system and the roles of GPs, specialists and emergency departments; comfortable with everyday English, but struggles with medical and insurance terminology |
| Attitude towards AI | Has never used it and does not really trust it, particularly with her health information |
| Typical behaviour | Asks classmates first when a problem arises; avoids phone calls in English; would rather put things off |

**Suggested speaking roles**: One person covers the problem (Acts 1–3, drawing on personal experience); one covers the solution and demonstration (Acts 4–6, operating the prototype); one covers value and the closing (Act 7). The remaining team members share Q&A responsibilities. Use no more than three main speakers.

## Act 1: How We Discovered the Problem

The purpose of this act is to establish credibility: we are not guessing what users experience; we are the users. Speak in the first person.

### Slide 1 · Title

- Title: **My Bupa Agent** — Your health, handled. In your language.
- Subtitle: Team 4D · Challenge 4: Data
- Visual: Thumbnails of the product's three pages: chat, Dashboard and Profile.

### Slide 2 · We are the users

- On screen: Photos of all six team members, with one line underneath: “6 international students. 6 Bupa OSHC members. 0 of us had opened the app before this hackathon.” (Replace the numbers with the actual figures.)
- Script: We all bought Bupa OSHC because our visa required it. Then we never touched it. When we asked ourselves why, we found three things we had in common.
- Three things in common, revealed one at a time:
  1. We didn't know how healthcare works here. GP, specialist, emergency, telehealth: which one, when, and what does it cost?
  2. We didn't know what our cover actually included. Nobody reads a policy document in a second language.
  3. Talking to Bupa cost us more than it cost a local: calling in English about medical terms is stressful, so we just didn't.
- Closing line: The result was the same for all of us: we delayed care.

### Slide 3 · Evidence (optional; keep for Q&A)

- Team research: “We asked N international students…” — insert actual figures: the proportion who had never used the app, the proportion who had delayed care because of cost uncertainty or language barriers, and two direct quotes from interviews.
- Public data: ABS 2024–25: 22% of people aged 25–34 who needed dental care delayed or did not receive it because of cost. State that these are national figures, not figures for Bupa members.
- Script: This isn't just us. Cost uncertainty alone keeps one in five young Australians away from the dentist.

## Act 2: From Four Problems to Product Goals

### Slide 4 · Four problems, one persona

- Left: Lin's persona card: name, age, OSHC, third week of university, and “Has never opened My Bupa.”
- Right: Four problem statements:
  1. **Don't know what I have** — what's covered, what I pay.
  2. **Don't know where to go** — GP vs specialist vs telehealth vs emergency.
  3. **Language barrier** — policy terms and phone calls in a second language.
  4. **Even when I know, I can't get it done** — find a clinic, compare costs, book, claim: every step is a hurdle.
- Script: We turned our experience into one persona, Lin, and four problem statements. The first three are about knowing. The fourth is about doing. Most solutions stop at the first three.

### Slide 5 · What we set out to build

- Key message: **An AI that makes talking to Bupa simpler, easier and in your own language, and then gets things done for you.**
- Three design principles, aligned with the challenge:
  - Use what Bupa already knows first: policy, cover, waiting periods.
  - Ask for new information only when it unlocks something concrete.
  - Every share is visible, explained, and reversible.
- Script: The challenge asks two things: get more value from existing data, and build a value exchange customers trust. Our principle is simple: Bupa gives first, asks second, and every ask buys the customer something they can see.

## Act 3: Investigating My Bupa and Finding the Blind Spot

### Slide 6 · What My Bupa already has

- On screen: Three screenshots of the existing app, side by side: AI chat, find-a-doctor, and booking. Add a short assessment under each:
  - AI chat: answers questions, but only by tapping preset options. It shows information; it can't act on it.
  - Find a doctor / book an appointment: they exist and work, but the user has to know to look for them, and fill everything in alone.
- Place a large “disconnected” symbol between the chat and the other features.
- Script: We went into the app and were surprised: almost everything Lin needs is already there. There's an AI chat. There's find-a-doctor. There's booking. The problem isn't missing features. **The problem is that they don't talk to each other.** The chat can tell you that you should see a GP. It can't book one. And the booking form doesn't know anything the chat just learned.

### Slide 7 · The blind spot

- Key message: **Information and action live in different rooms.**
- Left: “AI that talks” (chat). Right: “Features that do” (find-a-doctor, booking, policy, claims). Middle: “Lin has to be the bridge.”
- Script: Today, Lin is the integration layer. She reads the answer in the chat, remembers it, goes to another screen, and types it all in again, in English. That's exactly the step where she gives up. This is the same shift the industry saw in 2024–2025: AI moved from chat windows to agents that use tools. Bupa's chat hasn't made that move yet.

## Act 4: Our Solution and Innovation

### Slide 8 · Our answer: connect them

- Key message: **My Bupa Agent: the AI chat becomes the front door to everything the app can already do.**
- Three components, with three small visuals:
  - **AI Agent** — you say what you need, in any language. It checks your cover, finds a clinic, opens the booking form and fills it in. You confirm every page. It never submits for you.
  - **Profile** — one place for everything Bupa knows about you: personal details, your cover, your preferences, and a switch on every field: “may the AI use this?”
  - **Dashboard** — your calendar and reminders, plus a **health summary** built from what you've shared. Every booking the Agent makes lands here.
- Bottom line on the slide: With your permission, the Agent uses your past conversations and your health summary to make the next suggestion more personal.
- Script: We didn't add a new feature. We put the AI in charge of the features that already exist, and gave the user two places to see and control what the AI knows.

### Slide 9 · How Lin learns to trust it (answering the judges' question: “How do you make users comfortable sharing?”)

- Key message: **We don't ask Lin to trust AI. The Agent starts as a translator and earns promotions.**
- A four-level ladder, shown as four horizontal panels:
  - Level 0 Translator — explains your cover in your language, remembers nothing.
  - Level 1 Form-filler — fills in forms; you press every button.
  - Level 2 Assistant — prepares bookings; you confirm once. Needs your postcode and language, with consent.
  - Level 3 Steward — watches waiting periods and follow-ups, reminds you.
- Three rules: It only asks for a promotion right after it has done something useful. You can watch a demo before promoting it. You can demote it to Level 0 any time, and it forgets.
- Script: Every level up, Lin shares a little more and gets a little more, always in that order. Data is what she hands over when she promotes it, not something we take.

If time is short, condense this slide into one line at the bottom of Slide 8 and save the full explanation for Q&A.

## Act 5: Use Case 1 — Booking a GP for the First Time (One-off)

### Slide 10 · Use case 1: “I want a health check”

Demonstrate the actual prototype with DEMO_MODE enabled. Keep a six-panel flow diagram on the slide as a backup. Target duration: 60 seconds.

| Step | What happens on screen | One-line script |
| --- | --- | --- |
| 1 | After logging in, open **Profile**: name, membership number, OSHC policy and waiting periods are already there, all from Bupa's existing data; personalisation completeness is 1/5. | Lin logs in for the first time. Bupa already knows this much about her. She hasn't shared anything yet. |
| 2 | Switch to **AI Agent** and type in Chinese: “I've just arrived in Melbourne and would like to see a doctor for a health check. I don't know whether my insurance covers it.” | She types in Chinese. She doesn't know the word “GP”. |
| 3 | The Agent replies in Chinese: it explains that a GP is the place to go for a health check in Australia, that her OSHC covers GP services, and the estimated range of out-of-pocket costs, with a reference to the policy clause. It then says, “I can help you book an appointment.” | It answers from her policy, with the clause it read. Then it offers to do the booking. |
| 4 | The **booking wizard** opens on the right. Page 1 is prefilled: service type “GP” and reason “health check”, with “From conversation” labels beside the fields. She clicks “Next”. | The form opens, already filled from what she just said. Every field shows where it came from. |
| 5 | On Page 3, “Clinic”, a **consent card** appears beside the postcode field: “We need your postcode to find nearby clinics. It will not be used for pricing or claims. This time only / Always / Decline.” She chooses “This time only”. Three clinics appear, with estimated out-of-pocket costs and “Chinese-speaking” labels. | **This is the value exchange.** One postcode, one clear reason, one visible result. She can say no and still continue. |
| 6 | On Page 4, “Patient”, her name, membership number and phone number have been filled in from Profile, with “From Profile” labels. On Page 5, she reviews the summary and clicks **Submit**. | She checks each page and presses Submit herself. The Agent never can. |
| 7 | Switch to **Dashboard**: the appointment card appears on the calendar, with a “What to bring” list and a reminder one day before the appointment. A “Health check · Booked” entry is added to the health summary, and a receipt appears in Profile. | Done. It's on her calendar, her summary is updated, and there's a receipt for the one thing she shared. |

Closing line: One sentence in Chinese, one postcode, one confirmation. Five minutes ago she didn't know what a GP was.

**Demo risk controls**: Copy the chat input to the clipboard in advance; DEMO_MODE runs without a network connection; record a 60-second screen capture as a fallback.

## Act 6: Use Case 2 — Data That Keeps Working Over Time (Arm Injury)

### Slide 11 · Use case 2: “Data that keeps working”

This scenario demonstrates that shared data continues to work for the user beyond a single interaction. Target duration: 40 seconds. If the prototype cannot be finished in time, explain it using three screenshots.

| Step | What happens on screen | One-line script |
| --- | --- | --- |
| 1 | Two weeks earlier: Lin tells the Agent, “I fell and injured my arm. It really hurts and I can't lift it.” She passes the safety check, which identifies the situation as non-emergency. The Agent helps her book a GP using the same flow as Use Case 1. | Two weeks ago, Lin hurt her arm. Same flow: she said it, the Agent booked it. |
| 2 | At submission, an additional consent card appears: “Add this visit to your health summary so we can follow up later? We will only save the category (arm injury), not the original conversation.” She agrees. | One more question, one more receipt: may we remember that this happened? Category only, not her words. |
| 3 | The Dashboard health summary shows: “Arm injury · GP visit · September 16”. | It shows up in her health summary. Not a diagnosis, a record of what she told us and what she did. |
| 4 | Today: an **AI suggestion card** appears on the Dashboard: “You saw a GP for an arm injury two weeks ago. Follow-up is generally recommended for this type of injury. Would you like to book a follow-up appointment?” A small line underneath reads: “Because you allowed me to remember this visit.” | Today the Agent comes back to her, and tells her exactly why it knows. |
| 5 | She clicks “Yes”. The wizard opens with everything prefilled: the same clinic, the same doctor, and “arm injury follow-up” as the reason. She only chooses a time and clicks Submit. | This time she doesn't type anything. She picks a time and confirms. |
| 6 | Optional, 10 seconds: switch to Profile and click “Withdraw consent” for that visit record. The health summary entry and suggestion card disappear, and the Agent says, “I no longer remember this visit.” | And if she changes her mind, the memory goes, and so does the suggestion. |

Closing line: The first time, Lin taught the Agent. The second time, the Agent looked after Lin. That's what a value exchange looks like over time.

**Wording boundary**: Do not put medical judgements such as “You need a follow-up” on the suggestion card. Use only: “Follow-up is generally recommended for situations like this; please follow your doctor's advice.” If judge Sharon asks whether the AI is providing medical advice, the answer is that it offers a “follow-up” reminder, not a “diagnosis”, and every suggestion explains its basis.

## Act 7: Feasibility, Business Impact and the Future Platform

### Slide 12 · Why this is buildable now (Feasible)

- Key message: **We didn't build anything new. We rewired what exists.**
- Three points:
  - Every tool the Agent uses is an existing My Bupa capability: policy lookup, find-a-doctor, booking, reminders.
  - Tool-calling AI is mature technology. Our agent loop is under 200 lines; the hard rules (consent before use, user presses Submit) live in ordinary code, not in the model.
  - Working prototype today: three pages, the wizard, consent and receipts, demo mode without network.
- Script: The reason this is feasible is the same reason it was missing: the pieces already exist. Connecting them is engineering, not research.

### Slide 13 · What Bupa gets (Viable)

- Left column, **Today**:
  - Fewer simple support calls: cover questions and bookings handled in-app, in any language.
  - Bookings routed to Bupa's own network: dental, optical, health centres, Blua.
  - Fewer surprise out-of-pocket complaints: costs explained before the visit.
  - Structured, consented need data (language, region, need category) instead of unusable chat logs.
- Right column, **Long term**:
  - New members who use their cover in the first 90 days stay. OSHC students become domestic members after graduation.
  - Bupa has said it is moving from insurer to health partner. **The Dashboard is that platform**: today it holds bookings and a health summary; tomorrow it can carry health programs, Blua telehealth, mental-health support and follow-up care, all with the same consent model.
- Script: For Bupa this isn't a chatbot upgrade. It's the front door to the health ecosystem Bupa is building, and it's a front door customers will actually walk through.

**Reminder on figures**: Do not invent percentages. If you want to illustrate scale, use a testable assumption such as “If each new member made one fewer call in their first 90 days…” and label it as an assumption.

## Closing and Q&A Preparation

### Slide 14 · Close

- Only one sentence on screen: **Bupa already knows enough to help Lin. We just let it act.**
- Script: We started as six students who never opened the app. We're ending with a product we'd use tomorrow. Thank you.

### Anticipated Judges' Questions and Answers

| Question | Key points to cover | Slide to return to |
| --- | --- | --- |
| How is this different from the existing AI chat? | The existing chat only displays information; ours can call features, prefill forms and write to the Dashboard, with consent and receipts at every step. | Slide 7 |
| Why would users be willing to share? | Give before asking; every share produces an immediate result; the trust ladder starts with “remember nothing”; users can downgrade at any time. | Slide 9 |
| What if the AI gets cover or costs wrong? | Provide ranges and references to policy clauses, mark them “Needs confirmation”, make no promises about claim payments, and refer complex cases to a human with an English summary. | Slide 10, Step 3 |
| Does the arm injury follow-up suggestion count as medical advice? | It reminds users to follow up and does not diagnose; every suggestion explains its basis; the doctor's advice takes precedence; users can turn it off. | Slide 11 |
| How is sensitive information, such as mental health information, handled? | Separate consent; categories only; “This time only” by default; excluded from marketing and claims assessment. | Slide 9 |
| Could this affect premiums or claims? | The receipt explicitly states that the data will not be used for pricing or claims assessment. Australian private health insurance uses community rating, so premiums cannot be differentiated by health status in the first place. | Slide 10, Step 5 |
| How will success be measured? | Consent rate, withdrawal rate, task completion rate, support call volume in new members' first 90 days, and bookings for Bupa's own services. Propose a 90-day pilot during one university's new-student intake. | Slide 13 |
| Who else could use this besides international students? | Young people buying private health insurance on their own for the first time, and newly arrived migrant families. All new members face the same problems in their first 90 days. | Slide 4 |
| Can this connect to real systems? | The prototype uses mock interfaces; its tools map to existing app capabilities. The interface details need to be confirmed with Bupa; be honest that this is an assumption. | Slide 12 |

**Q&A rule**: Assign one designated person to answer each question, in no more than 30 seconds. If you do not know, say, “That is an assumption we need to confirm with Bupa.” Do not improvise facts.

## The 3-Minute Version: Selection and Timing

Fourteen slides will not fit into three minutes. Use only the nine slides below during the pitch, keeping the remaining slides at the end of the deck for Q&A. Allocate time according to the judging weights: the problem and demonstration (Desirability) should take more than half the time.

| Time | Slide | Content | Seconds |
| --- | --- | --- | --- |
| 0:00 | 1 | Title: one sentence only. | 5 |
| 0:05 | 2 | We are the users: three things in common, leading to delayed care. | 30 |
| 0:35 | 4 | Lin and the four problems, emphasising the fourth. | 20 |
| 0:55 | 7 | The blind spot: the features are all there, but disconnected. Incorporate Slide 6's screenshots here. | 20 |
| 1:15 | 8 | Solution: Agent + Profile + Dashboard. Summarise the trust ladder in one sentence. | 20 |
| 1:35 | 10 | Live demonstration of Use Case 1: Steps 2–5 and 7, skipping the Profile preview. | 50 |
| 2:25 | 11 | Use Case 2: cover only Steps 3–5, using screenshots. | 20 |
| 2:45 | 12+13 | Merge into one slide: “We didn't build anything new” + “The Dashboard is the future health platform.” | 12 |
| 2:57 | 14 | Close with one sentence. | 3 |

Slides to condense or move to backup: 3 (evidence), 5 (product goals), 6 (existing app screenshots), and 9 (the full trust ladder). If the judges ask why users would share, go straight to Slide 9.

**Rehearsal requirements**: Time at least three full run-throughs. Practise the demonstration separately five times, until the operator can deliver the script without looking at the screen. If the pitch runs over time, cut Use Case 2 first; do not cut the consent-card step in Use Case 1.

## Slide Production Tips and Items to Confirm

**Visual principles**

- Give each slide one headline sentence: use the “key message” above. Keep body text to no more than four lines. Put the script in speaker notes, not on screen.
- From Slide 4 onwards, place Lin's portrait and name in the corner of every slide so the judges follow the same person throughout.
- Use actual My Bupa screenshots on Slides 6–7. Observe the NDA: show them only at the event; do not distribute them externally.
- Use the page structure diagram from the product definition document on Slide 8, and the end-to-end flow diagram as backup on Slide 10.
- Highlight three interface elements in screenshots: consent cards, source labels and receipts. They are central to the challenge.

**Actual figures to fill in before the pitch**

- [ ] How many of the six team members have used My Bupa (Slide 2).
- [ ] Classmate questionnaire: sample size, percentage who have never used the app, and percentage who have delayed care (Slide 3).
- [ ] Two direct quotes from interviews (Slide 3).
- [ ] Confirm the exact boundaries of the existing AI chat and booking features with the Hack Challenge Expert, to avoid inaccurate claims on Slide 6.

**Changes from your verbal description (please confirm)**

- “Report” is called **health summary** in this document and sits in the Dashboard. It records “what the user told us and what they did”, rather than a medical diagnosis. This wording is safer.
- Adding a visit to the health summary requires separate consent (Use Case 2, Step 2), rather than happening automatically. This follows the challenge's requirement for voluntary participation.
- The arm injury follow-up wording has been changed to “Follow-up is generally recommended for situations like this”, rather than “You need a follow-up.”
- The trust ladder has been added as Slide 9 because judges have already asked, “Why would users feel comfortable sharing?” In the 3-minute version, cover it in just one sentence.
