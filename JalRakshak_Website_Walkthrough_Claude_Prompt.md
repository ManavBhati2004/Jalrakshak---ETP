# JalRakshak Website Walkthrough Design Prompt

Use this prompt in Claude and attach the reference image along with screenshots of the relevant JalRakshak pages.

---

## Prompt for Claude

I have a web application named **JalRakshak**. I want to create a series of **website walkthrough graphics** that explain how users can use different sections of the platform.

Use the attached reference image as a **strict visual and layout reference**. Recreate the same premium, clean, instructional design style for JalRakshak.

## Objective

Create walkthrough graphics using actual screenshots of the JalRakshak website. Each graphic should highlight four important interface elements with numbered information cards, curved connector lines, and directional markers.

Do not redesign the JalRakshak dashboard or modify any existing functionality. Only create the walkthrough presentation around the website screenshots.

## Exact Design Requirements

### 1. Overall Canvas

- Use a landscape canvas with an approximate aspect ratio of **1.72:1**.
- Recommended export size: **1720 × 1000 px** or a similar high-resolution ratio.
- Use a very light warm off-white background.
- Add an extremely subtle pale green or blue gradient toward the edges.
- Use a large outer container with:
  - 22–28 px rounded corners
  - Thin light-grey border
  - Generous internal spacing
  - Very subtle shadow
- Add a second thin rounded border approximately 25–30 px inside the outer container.

### 2. Header Area

Place the header in the upper centre.

Structure:

```text
— JALRAKSHAK PLATFORM WALKTHROUGH —

Main heading explaining the page

One-line supporting description
```

Style:

- Small uppercase eyebrow text
- Teal colour
- Wide letter spacing
- Short horizontal lines on both sides
- Bold, large, dark main heading
- Smaller muted-grey subtitle
- Centre-aligned
- Use a modern font such as Inter, Manrope, DM Sans, or a similar sans-serif font

Example:

```text
— JALRAKSHAK PLATFORM WALKTHROUGH —

Manage your ETP operations in one place

Monitor entries, operational data, compliance information, and daily activities.
```

### 3. Central Website Screenshot

- Place the JalRakshak page screenshot in the centre.
- Display it inside a realistic browser-window frame.
- The browser frame should have:
  - White background
  - Rounded top corners
  - Three small browser-control circles in the upper-left corner
  - Soft shadow
  - Light-grey border
- Keep the website screenshot large and readable.
- Do not blur, stretch, distort, crop, or recreate the actual interface.
- Maintain the original screenshot proportions.
- The browser mockup should occupy approximately 60–65% of the canvas width.

### 4. Information Cards

Add four numbered information cards around the central screenshot:

- Card 01: upper-left
- Card 02: upper-right
- Card 03: lower-left
- Card 04: lower-right

Each card must contain:

```text
01

Feature title

A short explanation of one or two lines.
```

Card styling:

- Width: approximately 18–20% of the canvas
- Rounded corners: 12–16 px
- Soft pastel background
- Very subtle border
- Soft shadow underneath
- 20–24 px internal padding
- Left-aligned text
- Small circular white badge containing the number
- Bold dark feature title
- Smaller muted description
- Consistent spacing and typography

Use alternating subtle colours:

- Pale sage green
- Warm light grey or beige
- Pale blue-green
- Very light mint

Do not use bright or highly saturated colours.

### 5. Connector Lines

Connect each card to the exact feature being described inside the screenshot.

Connector styling:

- Use smooth curved lines rather than straight lines.
- Lines should be approximately 3–4 px thick.
- Alternate between:
  - JalRakshak teal
  - Dark charcoal
  - Deep green
- The line should begin near the card and curve naturally toward the selected interface feature.
- At the interface endpoint, add:
  - A small white circular centre
  - A coloured outer ring
  - A filled triangular pointer behind or beside the circle
- The lines must not unnecessarily cover headings, form labels, buttons, or important data.
- The connectors should look clean and professionally drawn.

### 6. Footer Label

At the bottom centre, add a compact walkthrough indicator.

Example:

```text
1   JALRAKSHAK PLATFORM WALKTHROUGH
```

Design:

- Page number inside a small teal rounded-square badge
- Uppercase teal text
- Small font with moderate letter spacing

## Content Selection

Inspect the supplied JalRakshak screenshot and identify the four most important actions or features visible on that page.

For example, for an ETP entry page, the cards may explain:

```text
01  Select the facility
Choose the relevant plant or facility before entering operational information.

02  Enter daily readings
Record the required ETP parameters using the available input fields.

03  Review entered values
Check the readings carefully before submitting the form.

04  Save the ETP entry
Submit the completed entry while preserving the application’s existing validation logic.
```

The feature titles and descriptions must be based on the actual interface. Do not invent functions that are not present in JalRakshak.

## Multiple Walkthrough Graphics

Create separate walkthrough graphics for the important JalRakshak modules. Use the same design system for every graphic.

Suggested sequence:

1. Dashboard overview
2. ETP data entry
3. Viewing previous ETP records
4. Alerts or compliance status
5. Reports and analytics
6. User or facility management

Each graphic should have a different screenshot and relevant annotations, but the layout, typography, colours, cards, browser frame, and visual language must remain consistent.

## Responsive Behaviour

When implemented as a web section:

- Maintain the exact desktop composition on large screens.
- On tablets, reduce the card size while keeping the screenshot readable.
- On mobile:
  - Place the screenshot first
  - Stack the information cards underneath it
  - Replace long connector lines with small numbered markers on the screenshot
- Prevent text overflow and overlapping.
- Preserve accessibility and legibility.

## Technical Requirements

Create this as a reusable component using the project’s existing technology.

Preferred implementation:

- React or Next.js
- TypeScript
- Tailwind CSS
- SVG paths for curved connector lines
- Reusable data-driven annotation cards

Suggested component structure:

```text
WalkthroughGraphic
├── WalkthroughHeader
├── BrowserMockup
├── AnnotationCard
├── ConnectorOverlay
└── WalkthroughFooter
```

The annotation data should follow a structure similar to:

```ts
type WalkthroughAnnotation = {
  number: string;
  title: string;
  description: string;
  cardPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  targetX: number;
  targetY: number;
  connectorStyle: "teal" | "green" | "charcoal";
};
```

Use percentage-based target coordinates so that the connector positions remain aligned when the graphic is resized.

## Export Requirements

Produce:

- A reusable responsive webpage component
- High-resolution PNG export
- WebP version for website use
- A clean version without annotations
- A version with all four annotations
- Retina-quality output at 2× resolution

## Important Restrictions

- Do not modify any existing JalRakshak form logic.
- Do not change existing API calls, validation, field names, database behaviour, or submission flow.
- Do not redesign the screenshot itself.
- Do not replace actual website elements with generic mockups.
- Do not use stock images.
- Do not add excessive decorative graphics.
- Do not allow connector lines to overlap information cards.
- Do not make the cards or browser frame look bulky.
- Match the attached reference image as closely as possible in spacing, proportions, visual hierarchy, softness, and overall premium appearance.

Before completing the task, compare the final output side-by-side with the reference image and adjust the spacing, card positions, connector curves, typography, shadows, and border radii until the design closely matches the reference.
