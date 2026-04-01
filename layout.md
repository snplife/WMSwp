# Layout System: xAI

## 1. Spatial Theme & Atmosphere

xAI's visual language is monochrome and brutally minimal, and the layout system must reflect the same discipline.  
The page should feel engineered, not decorated: strong geometric blocks, strict alignment, and intentional emptiness.

The core spatial behavior is a **two-zone cockpit**:
- a stable left rail (navigation + context),
- a fluid right workspace (content, analytics, operations).

Unlike glossy dashboard patterns, xAI-style layout avoids "floating card chaos."  
Sections are organized in clear, predictable rows that prioritize fast scanning:
- overview,
- control strip,
- primary operational blocks,
- detail tables.

Whitespace is not decorative here. It is structural.  
Distance between blocks communicates hierarchy more than borders, shadows, or color.

**Key Characteristics:**
- Dark full-canvas workspace with border-defined structure
- Stable left sidebar + adaptive right content lane
- Sharp, architectural containers (no soft rounded "tiles")
- Strict 8px rhythm with sparse scale jumps
- Full-width treatment for dense data modules (tables, timelines, logs)
- Layout priority: readability under load, not visual ornament
- Mobile collapse strategy favors single-column continuity

## 2. Grid Architecture & Roles

### Shell Grid
- Primary app shell: `grid`
- Columns: `280px minmax(0, 1fr)`
- Gap: `24px`
- Max width: `1460px`
- Horizontal centering enabled

### Content Grid
- Right workspace stacks vertical sections with controlled spacing.
- Internal grids use `minmax(0, 1fr)` to avoid overflow in complex cards.
- For dual-column analytics:
  - left = primary context
  - right = supporting metrics/actions

### Priority Rules
- If a module requires sustained horizontal scan (event logs, machine table, hourly matrix), it gets full-width placement.
- If a module is secondary or action-oriented, it can remain in side stack.

## 3. Spacing Scale & Rhythm

### Base Unit
- `8px`

### Approved Spacing Scale
- `4, 8, 16, 24, 32, 48, 64, 96`

### Usage Matrix

| Use Case | Recommended Value | Rationale |
|---------|-------------------|-----------|
| Intra-control spacing (chips/buttons) | 8px | Dense but clickable |
| Card internal padding | 16-24px | Comfortable reading and controls |
| Card-to-card in same section | 16px | Keeps logical grouping |
| Section-to-section | 24-32px | Clear hierarchy separation |
| Major scene shift (hero -> module) | 48-64px | Dramatic structural break |

### Rhythm Principles
- Prefer repeating one spacing step within a section.
- Avoid micro-variance (e.g. 13px, 19px) unless functionally required.
- Bigger jumps should signal semantic changes, not arbitrary visual taste.

## 4. Container Hierarchy

### Level 0: Canvas
- Full-page dark background, no panel lift.

### Level 1: Standard Section
- Background: `rgba(255,255,255,0.03)`
- Border: `1px solid rgba(255,255,255,0.1)`
- Radius: `0`
- Shadow: none

### Level 2: Interactive/Focused Section
- Border: `rgba(255,255,255,0.2)`
- Background: `rgba(255,255,255,0.05)`

### Prohibition Rules
- No glassmorphism blur containers as primary pattern.
- No large soft radii for dashboard blocks.
- No gradient-based visual grouping.

## 5. Module Layout Patterns

### MES Top Zone
- Two-column row:
  - Left: machine detail and operational context (dominant width)
  - Right: compact stack (active orders + OEE)

### MES Downtime by Hour
- Dedicated full-width row below MES top zone.
- Must not be squeezed into right sidebar stack.
- Header controls (day back/forward, shift switch) stay in one logical control line and wrap on narrow widths.

### KPI Strip
- Dense horizontal cards on desktop
- Auto-collapse to 2-column and then 1-column at smaller breakpoints

### Event Logs / Machine Tables
- Always full-width blocks when visible.
- Horizontal scroll via wrapper, not by shrinking columns to unreadable widths.

## 6. Data-Dense Layout Rules

### Table Wrapper
- Required for all wide tables
- Sticky header allowed
- Horizontal overflow contained in wrapper

### Table Sizing
- Default minimum width: `760px`
- Higher minimum widths acceptable for operational tables with many columns

### Row Behavior
- Zebra: subtle (`0.03` alpha)
- Hover: stronger but restrained (`0.08` alpha)

### Content Priority in Cells
- First column may expand naturally (identifier + metadata)
- Numeric/stat columns should stay narrow and aligned
- Action columns should remain right-end anchored where possible

## 7. Responsive System

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | `<640px` | Single column, stacked controls, compact paddings |
| Small Tablet | `640-768px` | Preserve section order, increase breathing room slightly |
| Tablet | `768-1024px` | Collapse dual-column analytics to one column |
| Desktop | `1024-1280px` | Full shell active, selective stack simplification |
| Large | `1280-1536px` | Stable two-zone dashboard with comfortable spacing |
| Extra Large | `1536-2000px` | Centered content, wider air around modules |
| Ultra | `>2000px` | Maintain max width and central alignment |

### Collapse Strategy
- Sidebar can remain but content grids collapse first.
- Priority and scanability over preserving original desktop symmetry.
- Control strips switch from inline to wrapped/full-width buttons.

## 8. Interaction Layout Behavior

### Toolbar Logic
- Desktop: controls align right or split left/right by meaning.
- Mobile: controls become stacked blocks, full-width click targets.

### Toggle Groups
- Inline on desktop with consistent gaps.
- Wrapped rows on smaller widths.
- Avoid horizontal overflow for critical controls.

### Motion Constraint
- No translate-lift animations in dense operational zones.
- Interaction emphasis should be done via border/opacity transitions.

## 9. Do's and Don'ts

### Do
- Keep main shell stable (`sidebar + workspace`) for orientation memory.
- Use full-width rows for high-density content.
- Preserve strict spacing tokens from the approved scale.
- Use `minmax(0, 1fr)` in nested grids to prevent overflow traps.
- Keep visual hierarchy driven by spacing and order.

### Don't
- Don't force all modules into card grids if scanning suffers.
- Don't compress tables to avoid scroll; use wrappers instead.
- Don't use decorative layout devices (floating offsets, overlap stacks).
- Don't mix multiple spacing scales in one section.
- Don't hide critical controls behind nested layouts on mobile.

## 10. Agent Prompt Guide

### Quick Layout Reference
- Shell: `280px + flexible content`
- Main gap: `24px`
- Section gap: `24-32px`
- Card padding: `16-24px`
- Max container width: `1460px`
- Full-width required: logs, tables, hourly downtime matrices

### Example Layout Prompts
- "Create a two-zone dashboard shell with a fixed 280px sidebar and a flexible workspace column. Keep 24px gap and 1460px max width."
- "Build MES top section as a two-column grid: wide machine detail left, compact OEE/actions right. Place hourly downtime in a full-width row beneath."
- "Implement responsive collapse: at tablet width switch analytic dual columns to one column; at mobile stack all toolbar controls full width."
- "Add a data-table section in a bordered wrapper with sticky header, 760px min-width, horizontal scroll, and subtle zebra/hover backgrounds."

### Iteration Checklist
1. Validate section order before styling details.
2. Ensure dense blocks are full-width when needed.
3. Check mobile control accessibility (44px touch targets).
4. Verify no overflow caused by missing `min-width: 0`.
5. Confirm layout still reads clearly with maximal data volume.
