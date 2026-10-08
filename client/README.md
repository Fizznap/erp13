# Snippet AI Assistant

Yes — this direction fits Snippet much better. The screenshots have a polished AI + education + premium mobile feel without becoming overly complicated.



I would make this the new Snippet visual direction:



Snippet UI direction



Overall



Clean white/off-white background



Very subtle pastel gradients



Liquid-glass-inspired surfaces



Large rounded corners: ~20–28px



Soft translucent cards with backdrop-blur



Thin, low-contrast borders



Very subtle shadows



Lots of whitespace



Smooth micro-animations



Mobile-first, but responsive on desktop





Important: don't make everything glass. The screenshots work because the glass effect is used selectively.



Color system



Instead of the current strict B&W UI, I'd use:



Base: #FAFAF8



Surface: white / translucent white



Primary: electric/lime green around #8FEA55



Secondary accents: very soft lavender, blue, mint



Text: near-black #111111



Secondary text: #777777



Borders: white/gray with low opacity





For Snippet, I'd probably use green as the signature AI color, similar to the Study Buddy screenshots.





---



Home screen



Instead of a traditional ERP dashboard:



┌──────────────────────────────┐

│  ☰       Good morning 👋   ◯ │

│                              │

│  What do you need today?     │

│                              │

│  ┌────────────────────────┐  │

│  │ ✦ Ask Snippet           │  │

│  │ Ask anything about      │  │

│  │ your course material    │  │

│  │                    →    │  │

│  └────────────────────────┘  │

│                              │

│  Quick Access                │

│                              │

│  ◯ Classroom   ◯ Attendance │

│  ◯ Resources   ◯ Results    │

│                              │

│  Today's Schedule            │

│  ┌────────────────────────┐  │

│  │ 10:00  DBMS             │  │

│  │        Room 204    →    │  │

│  └────────────────────────┘  │

│                              │

│  Attendance                  │

│  ┌────────────────────────┐  │

│  │ 87.4%                   │  │

│  │ ███████████████░░       │  │

│  └────────────────────────┘  │

│                              │

│  Feed                        │

│  ...                         │

│                              │

│  ┌────────────────────────┐  │

│  │  ◉    ◉    ✦    ◉     │  │

│  │ Feed Class AI Remind  │  │

│  └────────────────────────┘  │

└──────────────────────────────┘



The Ask Snippet button should be special



This is where I would take the strongest idea from your references.



A floating green/gradient AI button can sit above the navigation:



✦ Ask Snippet



Tap → expands into the AI interface.



The AI screen can have:



Large empty/airy header



Floating AI orb/icon



Subject chips



Glass input box



Camera/document attachment



Voice input



Source citations



"Based on your course material" indicator





This makes AI feel native to the ERP, instead of just another menu item.





---



Subject page



Use the same visual language:



←   DBMS                         ⋯



Database Management Systems

CS301 • Semester 5



┌──────────────────────────────┐

│ Your progress          72%  │

│ ███████████████░░░░          │

└──────────────────────────────┘



Coursework

┌──────────┐ ┌──────────┐

│ Resources│ │ Assignments│

│    24    │ │     3    │

└──────────┘ └──────────┘



Assessment

┌──────────────────────────────┐

│ Internal Test 1         82%  │

│ Quiz 1                  90%  │

└──────────────────────────────┘



AI Study

┌──────────────────────────────┐

│ ✦ Ask Snippet                │

│ Ask about DBMS material  →  │

└──────────────────────────────┘



Resources



This is where the glass + document cards can look excellent:



Resources



Search resources...       ⌕



All    Notes    Slides    PDFs



┌──────────────────────────────┐

│ ◉  DBMS Unit 1.pdf      ⋯   │

│    2.4 MB • 24 pages         │

│                              │

│    12 key topics extracted   │

└──────────────────────────────┘



┌──────────────────────────────┐

│ ◉  Normalization Notes       │

│    1.1 MB • 14 pages         │

│                              │

│    ✦ AI summary available    │

└──────────────────────────────┘





---



One thing I'd not copy from these designs



Don't make Snippet look like a generic AI study app.



Your advantage is that it is a college ERP + AI system.



So the visual hierarchy should be:



ERP functionality → Classroom

→ Attendance

→ Assignments

→ Results

→ Resources



with



AI woven through everything → Ask Snippet

→ Resource summaries

→ Course Q&A

→ AI study assistance



rather than:



> "AI app that happens to have college features."









---



The exact design philosophy I'd give your coding agent



> Redesign Snippet's frontend with a premium mobile-first educational UI inspired by modern iOS applications and the supplied reference screenshots. Use a restrained liquid-glass-inspired visual language: translucent white surfaces, subtle backdrop blur, thin low-contrast borders, soft shadows, large rounded corners, generous whitespace, minimal typography, subtle pastel gradients, and small green/lime accents for AI interactions.



Do not copy any reference screen literally. Use the references only for visual direction. Preserve Snippet's existing ERP information architecture, routes, functionality, APIs, authentication, RAG behavior, attendance logic, resources, assignments, results, and existing data.



Make the interface feel like a modern premium mobile application rather than a traditional college ERP.



Use the AI identity consistently through a distinctive green/lime "✦ Ask Snippet" interaction. AI should feel embedded into the product rather than being a separate chatbot.



Implement responsive layouts for 320px, 360px, 375px, 390px, 414px, 430px and larger desktop widths. Eliminate horizontal overflow and ensure every card, navigation element, input, modal, drawer, resource list and table adapts correctly.



Use glass effects selectively. Do not turn every component into glass. Maintain strong contrast, readability and accessibility. Avoid excessive gradients, excessive animations, excessive rounded elements, or visual clutter.



Keep animations subtle: page transitions, card interaction, AI button expansion, navigation state changes and loading states.



The final result should feel like: modern iOS education app + premium AI assistant + college ERP.







This is the direction I'd choose for Snippet. It is a much stronger visual identity than the current plain ERP/B&W treatment while still keeping the product functional.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://snippet-buddy-ai-09.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2445ae85-54a5-471e-90c0-3a8222e2caa4).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
