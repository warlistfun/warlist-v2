---
version: alpha
name: WARLIST V2
description: Bold, friendly, and operational neobrutalism for a mobile-first WhatsApp automation product.
colors:
  primary: "#F4C400"
  success: "#15803D"
  danger: "#B42318"
  ink: "#111111"
  paper: "#FFF9E8"
  surface: "#FFFFFF"
  muted: "#5B5B5B"
typography:
  display:
    fontFamily: Archivo
    fontSize: 2.5rem
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  heading-lg:
    fontFamily: Archivo
    fontSize: 2rem
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  heading-md:
    fontFamily: Archivo
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body-md:
    fontFamily: Archivo
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Archivo
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: Archivo
    fontSize: 1rem
    fontWeight: 700
    lineHeight: 1.25
  label:
    fontFamily: Archivo
    fontSize: 0.875rem
    fontWeight: 700
    lineHeight: 1.25
rounded:
  none: 0px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  page:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "{spacing.md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: 12px
  button-primary-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: 12px
  status-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: 8px
  status-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: 8px
  helper-text:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
---

## Overview

WARLIST V2 uses bold, friendly, and operational neobrutalism. The interface should feel direct and tactile without becoming noisy or playful at the expense of trust. Its primary audience uses Android, so narrow-screen clarity, thumb reach, readable status, and predictable forms take priority over decorative density.

The primary visual references are [neobrutalism.dev](https://www.neobrutalism.dev/) and the owner-provided [Neo Brutalism UI Library](https://www.figma.com/community/file/1613945708230609539/neo-brutalism-ui-library). Both are references for visual language only. WARLIST tokens, components, layouts, routes, and source are built from zero.

**Design Read:** Operational WhatsApp app for an Android-dominant audience, using bold but practical neobrutalism. Dial: ENERGY 2 / RHYTHM 2 / MOTION 1.

## Colors

The active chromatic palette contains three colors with separate jobs. They are not interchangeable decoration.

- **Primary (`#F4C400`):** Warm yellow for the highest-priority action, selected state, and a small number of focal highlights. Use dark `ink` text on it.
- **Success (`#15803D`):** Green only for confirmed positive state, such as connected, active, saved, or completed. Pair color with explicit text or an icon.
- **Danger (`#B42318`):** Red only for errors, disconnection, destructive actions, or attention that can cause loss. Pair color with explicit text or an icon.
- **Ink (`#111111`):** Main text, borders, hard shadows, and high-contrast controls.
- **Paper (`#FFF9E8`):** Warm page background. It keeps the product energetic without using pure yellow everywhere.
- **Surface (`#FFFFFF`):** Forms, dialogs, and grouped content that must separate from the page.
- **Muted (`#5B5B5B`):** Supporting text only. It must not replace `ink` for primary content.

Verified WCAG 2.x contrast pairs:

- `ink` on `primary`: 11.46:1.
- `surface` on `success`: 5.02:1.
- `surface` on `danger`: 6.57:1.
- `ink` on `paper`: 17.95:1.
- `muted` on `paper`: 6.46:1.

Status must never rely on color alone. Yellow does not mean warning by default in WARLIST because it is the brand action color. Warning state must use explanatory copy and a distinct component treatment before a separate warning token is considered.

## Typography

Archivo Variable is the only initial type family. Weight and scale create hierarchy, which keeps the Android payload and visual system simpler than using separate display and body families.

- Use `800` for display and primary page headings.
- Use `700` for section headings, labels, navigation, and controls.
- Use `400` for body and supporting text.
- Keep body copy at `1rem` with `1.5` line height.
- Keep long-form lines near 65 characters where the layout allows it.
- Do not use monospace as decoration. Reserve it for genuinely technical data if that need appears.
- Use `Arial, sans-serif` as the fallback stack while Archivo loads or is unavailable.

Archivo will be self-hosted rather than loaded from a runtime CDN. The font is licensed under SIL Open Font License 1.1. The font file and license notice are added only when the frontend scaffold is authorized.

## Layout

Use mobile-first responsive layout with selective composition changes. There is one route tree and one component system, not separate Android and desktop frontends.

- Start from a single readable column on narrow screens.
- Add columns only where content has enough room, with breakpoints chosen where content stops working rather than from a device list.
- Keep primary touch targets at least 44 by 44 pixels with space between adjacent targets.
- Reserve safe-area space for any fixed bottom navigation so content is never covered.
- Do not ship horizontal page overflow.
- Use fluid type or deliberate responsive steps and verify text at 200 percent zoom.
- Keep source order aligned with visual and keyboard order.
- Use `md` spacing inside components, `lg` between related groups, and `xl` or `2xl` between major sections. Mobile spacing may use one smaller step where density requires it.

Desktop may use a sidebar and denser content composition. Mobile may use compact navigation or bottom navigation only after its destinations exist. Route and navigation labels must follow conventional web semantics and cannot point to unfinished pages without a visible coming-soon state.

## Elevation & Depth

Depth is expressed with hard geometry, not blur.

- Default interactive and raised surface border: `2px solid #111111`.
- Default raised shadow: `4px 4px 0 #111111`.
- Pressed state: translate by `2px 2px` and reduce shadow to `2px 2px 0 #111111`.
- Flat content groups may use the border without a shadow.
- Dialogs may use a stronger hard shadow only when they must clearly sit above the page.
- Do not apply shadows to every element. Shadow indicates interactivity or elevation.
- Focus uses a visible `3px solid #111111` outline with separation from the component edge. It must remain visible in every state.

## Shapes

WARLIST uses square geometry so the hard, direct neobrutalist silhouette stays consistent across public and app surfaces.

- `none` is the only radius token for buttons, inputs, cards, dialogs, and content blocks.
- Rounded and pill shapes are not used in the current product surface.
- Borders remain visually consistent across mobile and desktop.

## Components

Components are created only when a real product slice uses them.

- `page` establishes warm paper and dark readable text.
- `surface` groups forms, dialogs, or related content with a hard border. Add a hard shadow only when the surface is raised.
- `button-primary` is the single highest-emphasis action in a view. Its yellow fill is not repeated across every control.
- `button-primary-pressed` provides tactile feedback and must keep the action legible.
- `status-success` and `status-danger` communicate canonical state with text, not color alone.
- `helper-text` supports an input or state but does not carry essential information by itself.

Every data-bearing component must define useful loading, empty, and error behavior before it is considered complete. Every interactive component must work with keyboard and touch, show visible focus, and expose disabled state without relying only on reduced opacity.

## Do's and Don'ts

- **Do** use yellow for the primary action and a limited number of focal highlights.
- **Do** keep green and red semantic so users learn their meaning.
- **Do** use solid fills, bold borders, square corners, and purposeful hard shadows.
- **Do** state why a major color, layout, type, spacing, card, icon, or motion decision exists.
- **Do** build mobile as an intentional reflowed layout, not a squeezed desktop page.
- **Do** use real content or clearly marked placeholders.
- **Do not** copy source, class names, component code, layout templates, or assets from the visual references.
- **Do not** add blue, purple, gradients, soft shadows, glow, or glass effects without a product-specific purpose and owner approval.
- **Do not** fabricate metrics, testimonials, activity, users, or operational status.
- **Do not** use dead navigation or controls that have no behavior.
- **Do not** use perpetual animation. Motion is limited to interaction feedback and short state transitions at MOTION 1.
- **Do not** add dark mode until the owner chooses it as a real product requirement. Any theme that ships must be complete and verified.
