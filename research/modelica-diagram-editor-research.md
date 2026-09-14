# Modelica Diagram Definition & Existing Diagram-Editor Implementations

**Research report for: a new web-based Modelica diagram editor that must read/write Modelica graphic
annotations and be correct for ACAUSAL physical modeling.**

Compiled from primary sources (Modelica Language Specification source LaTeX + rendered HTML, MSL source
checkouts, vendor source code, standards documents). Every claim is tagged. **Corrections to the original
research brief are collected in [§0](#0-corrections-to-the-brief--claims-that-did-not-survive-verification).**

---

## EXECUTIVE SUMMARY

**The 12 findings most likely to change what you build:**

1. **§18.6 in the brief is 3.6 numbering.** In **Modelica 3.7 (published 2026)** Graphical Objects moved to
   **§18.9** (GUI to §18.10). Cite 3.6 or 3.7 explicitly. (see the table below)
2. **`Line` does not have `lineThickness` / `startArrowSize` / `endArrowSize`.** It has **`thickness`**
   (single) and **`arrowSize`** (single), plus **`arrow[2]`**. `lineThickness` belongs to **`FilledShape`**
   (i.e. `Rectangle`/`Polygon`/`Ellipse`). There is **no `Arrow` primitive** — `Arrow` is an enum.
   `Evaluate` has **no `breakpoints`**; `dynamicDraw` **does not exist**. (§0; independently confirmed
   against OMEdit source, which serializes `Line(... thickness=…, arrow={Arrow.None,Arrow.None}, arrowSize=…)`)
3. **`Transformation` semantics changed in MLS 3.6** — rotation is about **`{0,0}`, *not* the `origin`
   attribute**, applied **extent → rotation → origin**. MLS 3.5 said the opposite (rotation about `origin`;
   order scaling/flipping/rotation). Commit
   [`cbef87de`](https://github.com/modelica/ModelicaSpecification/commit/cbef87de335c956b7ec26ecdbb16ff7d3256af7e),
   2022-12-18, in tags v3.6/v3.7 only. **This is the #1 rendering-correctness trap.** (§1.5.1a)
4. **Connections DO carry their `Line` annotation in the source** (`connect(a,b) annotation(Line(points=…))`),
   and the annotation attaches via the generic `description` production, so *any* equation can carry one.
   A connect annotation may also carry a **`Text`** primitive with a **different schema** from the graphic
   `Text` (`string` not `textString`; adds `index`; supports `%first`/`%second`). (§1.6)
5. **Acausality is in the language, not the graphics.** `connect` is an equation; connection sets generate
   `a1 = a2 = …` (across) and `z1 + z2 + … = 0` (through). **Never persist or render a direction for a
   connection** — `connect(a,b)` ≡ `connect(b,a)`. Connector arrows in `Modelica.Blocks` are pure `Polygon`
   convention; physical connectors are symmetric. (§1.7)
6. **Preserving unknown `__vendor` annotations verbatim is the one normative obligation the spec places on
   tools** (§18.1). Design the parser to keep the full annotation tree. Real example found in the wild:
   Modelon's `DialogExtensions` (`hide`, `hideInEditingState`, `hideInNonEditingState`). (§1.11, §2.2.2f)
7. **OMEdit is Qt Graphics View**: `GraphicsScene : QGraphicsScene`, `GraphicsView : QGraphicsView`,
   `ShapeAnnotation : QGraphicsItem`, painted with `QPainter`. **No OpenGL for the diagram.** (§2.1)
8. **OMEdit does not write Modelica text** — it calls
   `OMCProxy::updateConnection(cls, start, end, "annotate=$annotation(Line(...))")` and OMC owns the AST and
   pretty-printer. **Modelon Impact does the same thing over REST.** A browser editor with no OMC must own a
   lossless round-trip itself. (§2.1, §2.2.2b)
9. **OMEdit forces orthogonal (Manhattan) connection routing** — `manhattanizeShape()` rewrites diagonals
   into axis-aligned pairs on endpoint drag (except `Smooth.Bezier`). MSL contains diagonal connection
   segments, so copying this silently rewrites library geometry. (§2.1)
10. **A browser Modelica parser already exists**: `OpenModelica/tree-sitter-modelica` ships
    **`tree-sitter-modelica.wasm`** + `web-tree-sitter.wasm` and documents Web Tree-sitter usage from
    TypeScript. But it gives a **concrete syntax tree, not a resolved AST** — no `extends` flattening,
    modifier application, conditional-connector evaluation, or `%par` substitution. (§2.2.5)
11. **Browser Modelica *simulation* ships today.** **Modiator** (Elmqvist & Otter, Modelica & FMI Conf 2025)
    is live and serves a byte-verified **`cvode.wasm`**; it uses a **DOM/CSS-`transform` infinite canvas**
    (not SVG/Canvas/WebGL), three.js and Plotly — but only **a subset** of Modelica. **Bodylight.js** does
    Modelica→FMU→WASM via Emscripten; **`modelica/fmi-ls-wasm`** is an explicitly **non-normative**
    prototype. The archived **OMWebEdit** used **React + `@projectstorm/react-diagrams` (SVG)**;
    **ModelScript** uses **SVG.js**. (§2.2)
12. **There is no Modelica Association graphics project, no MA graphics repo, and no diagram-interchange
    layered standard.** The interchange format for Modelica diagrams **is the annotated Modelica source
    text.** Adjacent standards: **FMI 3.0 §2.4.9** standardizes FMU/terminal icons + connection
    colour/stroke (but **no vector primitives**) and even suggests storing the Modelica connector
    annotation under `org.modelica.Modelica4Annotation`; **SSP 2.0 §5** standardizes placement, connector
    geometry and connection waypoints, and maps **acausal Modelica connectors to `kind="unspecified"`**.
    (§2.2.8, Part 3)

**Free scoping document worth reading in full:** Modelon's
[Graphical user interface limitations](https://help.modelon.com/latest/reference/limitations/) page is a
published list of which Modelica §18 features a mature commercial browser editor does *not* implement
(no connect `Text`, no `preserveAspectRatio`, no `Raised`/`Sunken`/`Engraved`, partial `Line` arrows, no
`Text.textStyle`/`fontName`/`fontSize`, **no base64 `imageSource`**, no `displayUnit`). (§2.2.2f)

---

Primary spec sources used throughout:

- MLS 3.6 HTML: <https://specification.modelica.org/maint/3.6/annotations.html> (Ch. 18),
  <https://specification.modelica.org/maint/3.6/connectors-and-connections.html> (Ch. 9),
  <https://specification.modelica.org/maint/3.6/modelica-concrete-syntax.html> (App. A).
- MLS 3.7 HTML: <https://specification.modelica.org/maint/3.7/annotations.html> (Ch. 18).
- MLS 3.7-dev / master LaTeX source (authoritative):
  <https://raw.githubusercontent.com/modelica/ModelicaSpecification/master/chapters/annotations.tex>,
  `chapters/connectors.tex`, `chapters/classes.tex`, `chapters/inheritance.tex`.
- Older releases for version archaeology: MLS 2.2/3.0/3.1/3.2/3.3 PDFs from
  <https://modelica.org/documents/>.
- MSL source: `git clone https://github.com/modelica/ModelicaStandardLibrary` (master = **4.2.0 dev**),
  plus tagged `v4.0.0` for stable citations.

### ⚠️ Section-numbering warning: **Chapter 18 is numbered differently in 3.6 and 3.7**

The brief says "Chapter 18 … §18.6". That is correct **for Modelica 3.6 only**. Verified against the
rendered HTML of both versions:

| Topic | **MLS 3.6** (published 2023) | **MLS 3.7** (published 2026) |
|---|---|---|
| Graphical Objects | **§18.6** | **§18.9** |
| Common Definitions | §18.6.1 | §18.9.1 |
| Coordinate Systems | §18.6.1.1 | §18.9.1.1 |
| Graphical Properties | §18.6.1.2 | §18.9.1.2 |
| Component Instance (`Placement`) | §18.6.2 | §18.9.2 |
| Extends-Clause (`IconMap`/`DiagramMap`) | §18.6.3 | §18.9.3 |
| Connections | §18.6.4 | §18.9.4 |
| Graphical Primitives | §18.6.5 | §18.9.5 |
| Line / Polygon / Rectangle / Ellipse / Text / Bitmap | §18.6.5.1–.6 | §18.9.5.1–.6 |
| Variable Graphics (`DynamicSelect`) | §18.6.6 | §18.9.6 |
| User Input (`interaction`) | §18.6.7 | §18.9.7 |
| Graphical User Interface (`Dialog`) | §18.7 | §18.10 |
| Connector Sizing | §18.7.1 | §18.10.1 |

Version publication dates, verbatim from <https://specification.modelica.org/>:
**3.8-dev** (master, not yet published), **3.7 (2026)**, **3.6 (2023)**, **3.5 (2021)**, **3.4 (2017)**,
3.3rev1 (2014), 3.2rev2 (2013), … back to 1.0 (1997).

**Sections below are cited with 3.6 numbers** (matching the brief) **with the 3.7 number given where it
differs.** All quoted text was checked in the 3.7-dev LaTeX source and, where noted, in both rendered
HTML versions.

**Also fixed in 3.7:** the arrow prose bug from §0. MLS 3.6 §18.6.5.1 reads "…so that **`lineThickness` = 10**
and `arrowSize` = 10 will touch at the outer parts", while MLS 3.7 §18.9.5.1 reads "…so that
**`thickness` = 10** and `arrowSize` = 10 will touch at the outer parts". So
[issue #3523](https://github.com/modelica/ModelicaSpecification/issues/3523) was resolved in 3.7 — a further
reason to treat `thickness` as the field name.

**Graphics-related changes listed for 3.7** (from the official 3.7 change list,
<https://github.com/modelica/ModelicaSpecification/blob/master/RationaleMCP/Changes/3_7/Readme.md>),
verbatim:
- "**Gradients in the graphical layers are now defined**, https://github.com/modelica/ModelicaSpecification/pull/3789"
- "**Texts on connection lines can now use `Automatic` for alignment** instead of relying on left-to-right drawing, https://github.com/modelica/ModelicaSpecification/pull/3845/"
- "**Default icon graphics**, https://github.com/modelica/ModelicaSpecification/pull/3624"

> ⚠️ This means the `FillPattern.HorizontalCylinder` / `Sphere` gradient semantics quoted in §1.3 are
> **newly normative in 3.7** — in 3.6 they were much less specified. An editor targeting 3.6-era libraries
> will encounter these fill patterns in MSL but cannot rely on 3.6 alone to define them.

---

## 0. Corrections to the brief — claims that did NOT survive verification

The brief contained several premises that are **not true of Modelica 3.5/3.6/3.7-dev**. Getting these
wrong would produce a subtly incompatible editor, so they are listed first.

| Brief claim | Verified reality | Evidence |
|---|---|---|
| `Line` has `lineThickness`, `startArrowSize`, `endArrowSize` | **False.** `Line` has **`thickness`** (single) and **`arrowSize`** (single) plus **`arrow[2]`**. `lineThickness` exists, but on **`FilledShape`** (i.e. `Polygon`/`Rectangle`/`Ellipse`), *not* on `Line`. | MLS 3.6 §18.6.5.1 vs §18.6.1.2; identical in 3.0→3.7-dev; MSL uses `thickness=0.5` |
| `startArrowSize` / `endArrowSize` exist at all | **False.** Zero occurrences in any spec version 3.0, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7-dev, in the spec git history, in MSL, or in OMEdit source. The only place "start/end arrow size" exists is **OMEdit's GUI**, which has *Start Arrow*, *End Arrow* dropdowns and a single *Arrow Size* field. Likely the origin of the confusion. | `grep` over all downloaded spec PDFs + `git log -S` on ModelicaSpecification; OMEdit User Guide "Line Style Options" |
| `Arrow` is a "newer graphic primitive" | **False.** `Arrow` is an **enumeration type** (`Arrow = enumeration(None, Open, Filled, Half)`), a *parameter of* `Line`. The complete primitive set is exactly **Line, Polygon, Rectangle, Ellipse, Text, Bitmap**. | MLS 3.6 §18.6.1.2 and §18.6.5.1–18.6.5.6 |
| `Evaluate` has a `breakpoints` sub-annotation, used for "interactive diagram manipulation" | **False.** `Evaluate` is a **`/*literal*/ constant Boolean`** annotation for **symbolic processing** (parameter evaluation at translation time). No `breakpoints` field exists. Interactive diagram manipulation is a *different* feature: the **`interaction`** annotation (§18.6.7). | MLS 3.6 §18.3 (`Evaluate`), §18.6.7 (`interaction`); `grep -i breakpoint` = 0 hits in MLS 2.2/3.0/3.1/3.2/3.3, ML Smaster, MSL, OMEdit |
| `graphics` annotation has a `dynamicDraw` attribute | **Unverified / almost certainly false.** Zero occurrences anywhere searched (MLS 2.2–3.7-dev, MSL, OMEdit). Dynamic graphics are done with **`DynamicSelect(static, dynamic)`** as the *value* of any graphic attribute. | MLS 3.6 §18.6.6; `grep -i dynamicDraw` = 0 hits |
| "`annotation(Diagram(...))` structure" / chapter numbering | Correct for 3.6: **Ch. 18 = Annotations, §18.6 = Graphical Objects**. Note 3.7-dev has *restructured* §18 (adds §18.1.1 "Notation for Annotation Definitions", §18.1.2 "Semantic Restrictions", and formal `\begin{annotationdefinition}` blocks). Section numbers quoted below are the **3.6** numbers, which match the brief. | MLS 3.6 TOC vs 3.7-dev `annotations.tex` |
| "Modelica annotation is the only option for diagram interchange" | **False** — see Part 3. FMI 3.0 §2.4.9 standardizes FMU/terminal icons + connection colour/stroke; SSP 2.0 §5 standardizes placement, connector geometry and connection waypoints. **But neither standardizes vector primitives** — Modelica §18.6 remains the only one that does. | FMI 3.0.1 §2.4.9; SSP 2.0 §5 |
| `connect` annotation is `Line` only | Slightly incomplete: the connect annotation may contain **`Line` and optionally `Text`**. The `Text` has a *different* schema from the graphic `Text` (field is `string`, not `textString`; adds `index`). | MLS 3.6 §18.6.4 |

---

# PART 1 — How Modelica diagrams are DEFINED

## 1.1 Two layers, not one: `Icon` and `Diagram`

MLS 3.6 §18.6:

> "A graphical representation of a class consists of two abstraction layers: **an icon layer and a diagram
> layer**… The icon typically visualizes the component by hiding hierarchical details, while the diagram
> layer typically shows the hierarchical decomposition using icons of subcomponents and lines representing
> connections."

Formal records (MLS 3.6 §18.6, §18.6.1.1):

```modelica
record Icon "Representation of the icon layer"
  CoordinateSystem coordinateSystem(extent = {{-100, -100}, {100, 100}});
  GraphicItem[:] graphics;
end Icon;

record Diagram "Representation of the diagram layer"
  CoordinateSystem coordinateSystem(extent = {{-100, -100}, {100, 100}});
  GraphicItem[:] graphics;
end Diagram;
```

**Critical rendering rule (MLS 3.6 §18.6):**

> "The `graphics` is specified as an **ordered sequence** of graphical primitives… Base class contents are
> drawn **behind** the graphical primitives of the current class, with base classes ordered from back to
> front according to the order of the `extends`-clauses, and graphical primitives according to order of
> appearance in the annotation."

This is a plain painter's-algorithm z-order: *extends-clauses first (in order, back to front), then this
class's `graphics` array in array order.* Any editor must reproduce this or icons will render wrong —
MSL relies on it heavily (e.g. `Modelica.Mechanics.Translational.Interfaces.Support` layers three
overlapping `Rectangle`s where the last one covers the earlier ones).

**`Diagram` note:** `Diagram` has exactly the same record shape as `Icon`; the only difference is intent.
Many MSL components define **only** `Icon` (e.g. `Modelica.Electrical.Analog.Basic.Resistor` — see §1.8),
and connectors may define *both* with different content.

## 1.2 Coordinate systems

MLS 3.6 §18.6.1.1:

```modelica
record CoordinateSystem
  /*literal*/ constant Extent extent;
  /*literal*/ constant Boolean preserveAspectRatio = true;
  /*literal*/ constant Real initialScale = 0.1;
  /*literal*/ constant DrawingUnit grid[2];
end CoordinateSystem;
```

with (`§18.6.1`):

```modelica
type DrawingUnit = Real(final unit="mm");
type Point = DrawingUnit[2] "{x, y}";
type Extent = Point[2] "Defines a rectangular area {{x1, y1}, {x2, y2}}";
```

Key semantics, quoted:

- **`extent` = `{{x1,y1},{x2,y2}}`**, "the left (x1) lower (y1) corner and the right (x2) upper (y2)
  corner, **where the coordinates of the first point shall be less than the coordinates of the second
  point**." Default `{{-100,-100},{100,100}}`.
- **`preserveAspectRatio`**: "specifies a **hint** for the shape of components of the class, but **does not
  actually influence the rendering** of the component. If true, changing the extent of components should
  preserve the current aspect ratio of the coordinate system of the class."
- **`initialScale`**: "the default component size as `initialScale` times the size of the coordinate system
  of the class" (default `0.1`). MSL *does* set this — e.g. `Modelica.Blocks.Interfaces.RealInput` uses
  `initialScale=0.2`.
- **`grid`**: snap-to-grid spacing; "its use and default value is tool-dependent."
- **Units**: `DrawingUnit` is **millimetres at natural (unscaled) print size**: "The interpretation of
  `unit` is with respect to printer output in natural size (not zoomed)." (Same nominal-mm convention
  SSP 2.0 later adopted — see Part 3.)

**Coordinate-system resolution priority** (MLS 3.6 §18.6.1.1), important for inheritance:

1. The `coordinateSystem` annotation given in the class itself, if specified.
2. The coordinate systems of the first base class where the `extent` on the `extends`-clause specifies a
   **null-region** (if any). *(null-region is the default for base classes.)*
3. The default `CoordinateSystem(preserveAspectRatio=true, extent = {{-100,-100},{100,100}})`.

## 1.3 Common graphical properties

MLS 3.6 §18.6.1:

```modelica
partial record GraphicItem
  Boolean visible = true;
  Point origin = {0, 0};
  Real rotation(quantity = "angle", unit = "deg") = 0;
  InteractionItem[:] interaction;
end GraphicItem;
```

- `origin`: "specifies the origin of the graphical item in the coordinate system of the layer in which it
  is defined… All geometric information is given relative the `origin` attribute."
- `rotation`: "rotation of the graphical item **counter-clockwise** around the point defined by the
  `origin` attribute."
- `visible`: any graphic item can be switched off. MSL uses this to hide conditional graphics, e.g.
  `Resistor`'s `Line(visible=useHeatPort, …)`.

```modelica
type Color = Integer[3](min = 0, max = 255) "RGB representation";
constant Color Black = zeros(3);
type LinePattern   = enumeration(None, Solid, Dash, Dot, DashDot, DashDotDot);
type FillPattern   = enumeration(None, Solid, Horizontal, Vertical,
                                 Cross, Forward, Backward, CrossDiag,
                                 HorizontalCylinder, VerticalCylinder, Sphere);
type BorderPattern = enumeration(None, Raised, Sunken, Engraved);
type Smooth        = enumeration(None, Bezier);
type EllipseClosure= enumeration(None, Chord, Radial, Automatic);
type Arrow         = enumeration(None, Open, Filled, Half);
type TextStyle     = enumeration(Bold, Italic, UnderLine);
type TextAlignment = enumeration(Left, Center, Right, Automatic);

record FilledShape "Style attributes for filled shapes"
  Color lineColor = Black "Color of border line";
  Color fillColor = Black "Interior fill color";
  LinePattern pattern = LinePattern.Solid "Border line pattern";
  FillPattern fillPattern = FillPattern.None "Interior fill pattern";
  DrawingUnit lineThickness = 0.25 "Line thickness";
end FilledShape;
```

Notes an implementer must not miss:

- The rendered border of a filled shape is **half inside, half outside** the extent: "The
  extent/points of the filled shape describe the theoretical zero-thickness filled shape, and the actual
  rendered border is then half inside and half outside the extent."
- `HorizontalCylinder`, `VerticalCylinder`, `Sphere` are **gradient** fills, not hatch patterns. "Gradients
  are defined for the geometry of a `GraphicItem` **before its `rotation` is applied**", and clipped to the
  shape. Cylinder gradients use the minimal enclosing axis-parallel rectangle; `Sphere` uses the smallest
  enclosing ellipse. **Many details are explicitly tool-specific** ("lighting and reflective properties of
  the imaginary cylinder are not defined by the specification").
- `Raised`/`Sunken`/`Engraved` border patterns are "rendered in a **tool-dependent** way — inside the
  extent of the filled shape."
- `smooth = Bezier` is precisely specified: points are **control points of a quadratic B-spline chain** —
  for points P1…Pn, midpoints P12, P23, …, P(n-1)n become arc endpoints and each original interior point
  becomes a control point; straight segments join P1→P12 and P(n-1)n→Pn. "For lines with only two points,
  the `smooth` attribute has no effect."

## 1.4 Every graphic primitive and its exact parameters (MLS 3.6 §18.6.5)

### 1.4.1 `Line` — §18.6.5.1

```modelica
record Line
  extends GraphicItem;
  Point points[:];
  Color color = Black;
  LinePattern pattern = LinePattern.Solid;
  DrawingUnit thickness = 0.25;
  Arrow arrow[2] = {Arrow.None, Arrow.None} "{start arrow, end arrow}";
  DrawingUnit arrowSize = 3;
  Smooth smooth = Smooth.None "Spline";
end Line;
```

> "Note that the `Line` primitive is **also used to specify the graphical representation of a connection**."

Arrow geometry, verbatim:
- "The arrow is drawn with an aspect ratio of **1/3** for each arrow half, i.e., if the arrow-head is 3 mm
  long an arrow with `Half` will extend 1 mm from the mid-line and with `Open` or `Filled` extend 1 mm to
  each side, in total making the base 2 mm wide."
- "The `arrowSize` gives the width of the arrow (including the imagined other half for `Half`) so that
  `thickness = 10` and `arrowSize = 10` will touch at the outer parts."
- "All arrow variants overlap for overlapping lines."
- "The lines for the `Open` and `Half` variants are drawn with `thickness`."

> ⚠️ **Spec editorial bug worth knowing:** the two last bullets say `lineThickness`, but the record field is
> `thickness`. Tracked as modelica/ModelicaSpecification issue **#3523**
> (<https://github.com/modelica/ModelicaSpecification/issues/3523>). Do not implement a `lineThickness`
> field on `Line` because of this prose.

### 1.4.2 `Polygon` — §18.6.5.2

```modelica
record Polygon
  extends GraphicItem;
  extends FilledShape;
  Point points[:];
  Smooth smooth = Smooth.None "Spline outline";
end Polygon;
```
"The polygon is automatically closed, if the first and the last points are not identical."

### 1.4.3 `Rectangle` — §18.6.5.3

```modelica
record Rectangle
  extends GraphicItem;
  extends FilledShape;
  BorderPattern borderPattern = BorderPattern.None;
  Extent extent;
  DrawingUnit radius = 0 "Corner radius";
end Rectangle;
```
"`extent` specifies the bounding box… If the `radius` attribute is specified, the rectangle is drawn with
rounded corners of the given radius."

### 1.4.4 `Ellipse` — §18.6.5.4

```modelica
record Ellipse
  extends GraphicItem;
  extends FilledShape;
  Extent extent;
  Real startAngle(quantity = "angle", unit = "deg") = 0;
  Real endAngle(quantity = "angle", unit = "deg") = 360;
  EllipseClosure closure = EllipseClosure.Automatic;
end Ellipse;
```
- Angles "specify the endpoints of the arc **prior to the stretch and rotate operations**", measured
  counter-clockwise from 3 o'clock (positive x-axis), arc drawn counter-clockwise start→end.
- `closure`: `Radial` = lines to the centre; `Chord` = single straight line between endpoints; `None` =
  left unconnected and "the ellipse is treated as an open curve instead of a closed shape, and the
  `fillPattern` and `fillColor` are **not applied**".
- `Automatic` = `Chord` when start=0 and end=360, else `Radial`.

### 1.4.5 `Text` — §18.6.5.5

```modelica
record Text
  extends GraphicItem;
  Extent extent;
  String textString;
  Real fontSize = 0 "unit pt";
  String fontName;
  TextStyle textStyle[:];
  Color textColor = Black;
  TextAlignment horizontalAlignment = TextAlignment.Center;
end Text;
```

**Macro substitution** — must be implemented; "in order such that the earliest ones have precedence, and
using the longest sequence of identifier characters (alphanumeric and underscore)":

| Macro | Replacement |
|---|---|
| `%%` | `%` |
| `%name` | name of the component (identifier in the enclosing class) |
| `%class` | class name, **last part only** of the hierarchical name |
| `%par` / `%{par}` | value of parameter/variable `par`. Numeric values **shall** be shown with `displayUnit`, BIPM-formatted (spec example: `parameter Real t(unit="s", displayUnit="ms") = 0.1` ⇒ display **100 ms**). Enumerations ⇒ item name, not full name. Composite/quoted names **require** the `%{…}` form. "If the parameter does not exist it is an error." |

Other rules:
- `fontSize = 0` ⇒ **text scaled to fit its extent**; otherwise absolute pt. Text is **vertically centred**
  in the extent.
- "If the `extent` specifies a box with **zero width and positive height** the height is used as height
  for the text… and the text is not truncated" — a common MSL idiom for unknown-width labels. In that case
  `horizontalAlignment` **must not** be `Automatic`.
- `fontName`: `"serif"`, `"sans-serif"`, `"monospace"` **shall** be recognized; empty ⇒ tool's choice.
- Text is drawn with **transparent background, no border, no outline**.

### 1.4.6 `Bitmap` — §18.6.5.6

```modelica
record Bitmap
  extends GraphicItem;
  Extent extent;
  String fileName "Name of bitmap file";
  String imageSource "Base64 representation of bitmap";
end Bitmap;
```

- `fileName` is a URI; "The mapping from the string to the file is specified for some URIs in
  [§13.5](https://specification.modelica.org/maint/3.6/packages.html#external-resources)" — in practice
  **`modelica://<Package>/Resources/Images/....png`**. Supported formats: **PNG, BMP, JPEG, SVG**.
- `imageSource` — **the newer inline variant**; "the string contains the image data, and the image format
  is determined based on the contents. The image is represented as a **Base64** encoding of the image file
  format (see RFC 4648)". ✅ *This claim in the brief is correct and present in 3.5, 3.6 and 3.7-dev.*
- Flipping: "Given an extent `{{x1,y1},{x2,y2}}`, `x2 < x1` defines **horizontal flipping** and
  `y2 < y1` defines **vertical flipping** around the centre of the object. The graphical operations are
  applied in the order: **scaling, flipping and rotation**."
- Aspect ratio: "The image is **uniformly scaled** (preserving the aspect ratio) so it exactly fits within
  the extent (touching the extent along one axis). The center of the image is positioned at the center of
  the extent." — i.e. `Bitmap` is *contain*, never *stretch*.

> **MSL reality check:** `grep -r imageSource` over the full MSL source returns **0 hits**. MSL uses
> `fileName="modelica://…"` exclusively (e.g. `Modelica.Thermal.HeatTransfer.Examples.Utilities.InverseCapacity`).
> `imageSource` exists in the spec but is essentially unused in MSL as of 4.2.0-dev.

### 1.4.7 There is no `Arrow` primitive

The primitive set is closed at **six**: `Line`, `Polygon`, `Rectangle`, `Ellipse`, `Text`, `Bitmap`
(§18.6.5.1–§18.6.5.6). Arrows are `Line` *parameters*. New primitives may only be added by vendors via the
`__vendor(...)` mechanism (§18.1) — e.g. the spec's own example
`graphics = {__NameOfVendor(Circle(center = {0,0}, radius = 10))}`.

## 1.5 `Placement` — how a component instance is drawn (MLS 3.6 §18.6.2)

```modelica
record Placement
  Boolean visible = true;
  Transformation transformation;
  Boolean iconVisible;
  Transformation iconTransformation;
end Placement;

record Transformation
  Extent extent;
  Real rotation(quantity = "angle", unit = "deg") = 0;
  Point origin = {0, 0};
end Transformation;
```

**`visible` vs `iconVisible`** — this is the conditional-port-visibility mechanism, and it is *asymmetric
between layers*:

- `visible` controls the component in the **diagram layer** of the *enclosing* class. "For a connector
  component, the component's **diagram layer** defines the content to be displayed, while the **icon
  layer** is used for other component kinds." *(Rationale in the spec: this "facilitates opening up a
  hierarchical connector to allow connections to its internal subconnectors.")*
- `iconVisible` "**only applies to public connector components**, and defines the visibility of the
  component in the **icon layer** of the enclosing class (**protected connectors are never visible in
  icons**). … The **default for `iconVisible` is to be the same as `visible`**."
- `iconTransformation` "only applies to public connector components, and defines the placement of the
  `Icon` annotation graphics in the icon layer… The **default for `iconTransformation` is the same as
  `transformation`**."
- Sub-connectors in a hierarchical connector "are only visible if they can be connected to."

The spec adds a non-normative warning that decoupling icon and diagram placement "should be used with
care" because a user opening a component's diagram view benefits from connectors being similarly placed.

### 1.5.1 Transformation order — **the single most important editor-correctness detail**

MLS 3.6 §18.6.2, verbatim:

> "It defines a coordinate system transformation by applying the attributes **in the order `extent`,
> `rotation`, `origin`**, as follows:
> 1. The `extent` of the component icon is mapped to the `extent` rectangle (**possibly shifting, scaling,
>    and flipping contents**).
> 2. The `rotation` specifies **counter-clockwise rotation around the origin (that is `{0, 0}`, not the
>    `origin` attribute)**.
> 3. The `origin` specifies a shift (moving `{0, 0}` to `origin`)."

So the composition is, in matrix terms:

```
p_parent = origin + R(rotation) · S(extent) · p_child
```

where `S(extent)` maps the child's `coordinateSystem.extent` onto the given `extent` rectangle. **Rotation
happens about `{0,0}`, not about the `origin` attribute and not about the extent centre.** Note also that
in the *graphic item* `rotation` (§18.6.1) rotation is about the item's `origin` attribute — a different
rule. An editor must keep these two rules distinct.

### 1.5.1a ⚠️ VERSION TRAP: `Transformation` semantics changed in Modelica **3.6**

This is a real, dated, commit-verified change, and it is the kind of thing that silently breaks rendering.

**Modelica 3.5 §18.6.2 (verbatim):**

```modelica
record Transformation
  Point origin = {0, 0};
  Extent extent;
  Real rotation(quantity = "angle", unit = "deg") = 0;
end Transformation;
```
> "The `origin` attribute defines the position of the component in the coordinate system of the enclosing
> class. The `extent` defines the position, size and flipping of the component, **relative to the `origin`
> attribute**. … The `rotation` attribute specifies rotation of the **extent around the point defined by the
> `origin` attribute**. The graphical operations are applied in the order: **scaling, flipping and
> rotation**."

**Modelica 3.6 §18.6.2 (verbatim):** as quoted above — rotation about **`{0,0}`, explicitly not the `origin`
attribute**, and order **extent → rotation → origin**.

**Verified version boundary.** `ModelicaSpecification` commit
[`cbef87de`](https://github.com/modelica/ModelicaSpecification/commit/cbef87de335c956b7ec26ecdbb16ff7d3256af7e),
"**Simplify presentation of Transformation for improved clarity**", 2022-12-18, author
**Henrik Tidefelt (Wolfram)** — 10 insertions, 9 deletions in `chapters/annotations.tex`. `git tag --contains`
puts it in **`v3.6` and `v3.7`**, and **not** in `v3.5`. The diff also moves `origin` from the **first**
record field to the **last**, mirroring the new application order.

> ⚠️ The commit message frames this as a *clarification*, but it **inverts the stated rotation centre** and
> reorders the operations. Any implementation that followed the MLS 3.5 prose literally will place rotated
> components differently from one that follows 3.6. A new editor must pick the 3.6 rule and test against
> real library files. (Corroborating real-world symptom: OpenModelica trac ticket
> **#3333 "in OMEdit, Rotating a component drags it in a far position"**,
> <https://trac.openmodelica.org/OpenModelica/ticket/3333>.)

**Practical editor rule:** because `rotation` is about `{0,0}` and the origin shift is applied *last*, a
rotation-only edit (rotation `0` → `90`) moves the component unless `origin` is compensated. A "rotate"
command in the UI must therefore solve for a new `origin` to keep the component visually anchored — that is
almost certainly what ticket #3333 is about.

**Mirroring / flipping.** Negative or reversed `extent` corners mean mirroring. The spec states this
explicitly for `Bitmap` (§1.4.6) and for `IconMap`/`DiagramMap`:

> "Reversed corners of the `extent` will result in **mirrored** (rotated if reversed in both direction)
> base class contents."

⚠️ The `Camera`-style caveat: `Transformation.extent` flipped in x only ⇒ horizontal mirror; flipped in
both x and y ⇒ equivalent to a 180° rotation. This matters when an editor offers a "mirror" command:
implementing mirror as `rotation += 180` is wrong in exactly one axis.

**Default outline for missing graphics** (§18.6.2.1) — an editor MUST handle this:

> "If the icon of a component placed in a diagram layer does not contain any graphical primitives
> (including inherited ones, **and regardless of `visible`-attributes; but excluding connectors**), tools
> **shall** show a **tool-dependent rudimentary outline** of the component's transformed `extent`."

Spec rationale, which is directly actionable for a new editor: making the outline deliberately ugly
"encourage[s] the model developer to provide a proper icon", and because `visible` is disregarded,
"it [is] possible to obtain an icon which only shows connectors by adding a dummy primitive with
`visible = false`."

### 1.5.2 `extends`-clause mapping: `IconMap` / `DiagramMap` (MLS 3.6 §18.6.3)

```modelica
record IconMap
  /*literal*/ constant Extent extent = {{0, 0}, {0, 0}};
  /*literal*/ constant Boolean primitivesVisible = true;
end IconMap;

record DiagramMap
  /*literal*/ constant Extent extent = {{0, 0}, {0, 0}};
  /*literal*/ constant Boolean primitivesVisible = true;
end DiagramMap;
```

- Default `extent = {{0,0},{0,0}}` ⇒ base-class contents mapped to the **same** coordinates; the
  coordinate system (and `preserveAspectRatio`) **can be inherited**.
- Any other `extent` ⇒ base-class coordinate system is mapped to that region; `preserveAspectRatio = true`
  in the base class "requires that the mapping shall preserve the aspect ratio. The base class coordinate
  system (and `preserveAspectRatio`) is **not** inherited."
- `primitivesVisible = false` ⇒ "components and connections are visible but graphical primitives are not."
- Non-normative: "A zero area `extent` other than `{{0,0},{0,0}}` will result in **none** of the base class
  contents being visible."

## 1.6 Connections in the diagram: `connect(...) annotation(Line(...))` (MLS 3.6 §18.6.4)

**Yes — connections DO carry their own graphical annotation, and it IS stored in the Modelica source.**
This is the direct answer to the brief's question, and the answer is the *opposite* of "the tool implies
it".

> "A connection is specified with an annotation containing a **`Line` primitive and optionally a `Text`
> primitive**."

Spec example, verbatim:

```modelica
connect(a.x, b.x)
  annotation(Line(points = {{-25, 30}, {10, 30}, {10, -20}, {40, -20}}));
```

The connection `Text` is a **different record** from the graphic `Text`. The spec is explicit ("it is not
equal to the `Text` primitive as part of graphics — the differences are marked with comments"):

```modelica
record Text
  extends GraphicItem;
  Extent extent;
  Integer index;                 // Not present in other Text
  String string;                 // Different name compared to other Text
  Real fontSize = 0 "unit pt";
  String fontName;
  TextStyle textStyle[:];
  Color textColor = Black;
  TextAlignment horizontalAlignment = TextAlignment.Automatic;
                                 // Different default compared to other Text
end Text;
```

- `index` "is one of the points of the `Line` (numbered 1, 2, 3, …, where **negative numbers count from
  the end**, thus -1 indicates the last one). The `origin` … is specified relative to this point".
- `string` "may use the special symbols **`"%first"`** and **`"%second"`** to indicate the connectors in
  the `connect`-equation."

Spec example (bus connection):

```modelica
connect(controlBus.axisControlBus1, axis1.axisControlBus)
  annotation(
    Text(string = "%first", index = -1, extent = [-6, 3; -6, 7]),
    Line(points = {{41, 30}, {50, 30}, {50, 50}, {58, 50}})
  );
```

### 1.6.1 How the annotation attaches syntactically

**It is a `description`, not a special connect-only clause.** MLS 3.6 App. A §A.2.6:

```
equation :
   ( simple-expression "=" expression
     | if-equation | for-equation | connect-equation | when-equation
     | component-reference function-call-args
   )
   description
...
description : description-string [ annotation-clause ]
annotation-clause : annotation class-modification
connect-equation :
   connect "(" component-reference "," component-reference ")"
```

So `connect(a,b) annotation(...)` is legal because *any* equation may carry a trailing annotation. There is
**no separate `connect`-specific annotation grammar**, and — answering the brief directly — **there is no
`Placement` and no `defaultComponentName` on a connect statement.** `Placement` is "Allowed for component
declarations" (§18.6.2); `defaultComponentName` is a **class** annotation (§18.7).

### 1.6.2 Is the connection `Line` optional? — and what to do when it is absent

**Yes, optional.** Ch. 18 preamble: "**Annotations are optional in the Modelica grammar** … The
specification in this document defines the semantic meaning **if** a tool implements any of these
annotations."

Consequence for an editor: `connect(a, b);` with no annotation is completely valid and common in
hand-written and generated code, and the spec does **not** require a particular rendering for it (unlike
the "rudimentary outline" rule for components, §18.6.2.1). The tool must synthesise a route. In practice
this is exactly what OMEdit does (§2.1): it derives an initial orthogonal ("manhattanized") polyline from
the connector positions and only then persists a `Line` annotation once the user edits it.

### 1.6.3 Real MSL connection annotation (verbatim)

`Modelica/Mechanics/MultiBody/Examples/Elementary/PointGravityWithPointMasses2.mo`:

```modelica
connect(fixedTranslation1.frame_a, fixedTranslation.frame_a)
  annotation(Line(
      points={{-20,-10},{0,-10}},
      color={95,95,95},
      thickness=0.5));
connect(fixedTranslation1.frame_a, fixedTranslation2.frame_a)
  annotation(Line(
      points={{-20,-10},{-10,-10},{-10,20},{0,20}},
      color={95,95,95},
      thickness=0.5));
```

Note: multi-point polylines are the norm, `thickness` (not `lineThickness`) is used, and no `arrow` is set
— connections in MSL are **unadorned polylines**.

## 1.7 Connections in the LANGUAGE: acausal by construction (MLS 3.6 Ch. 9)

This is the part that must drive the editor's data model. MLS 3.6 Ch. 9 preamble, verbatim:

> "Connectors and connect-equations are designed so that different components can be **connected
> graphically with well-defined semantics. However, the graphical part is optional and found in chapter
> 18.**"

### 1.7.1 `connect` is an equation, not dataflow (MLS 3.6 §9.1)

> "Connections between objects are introduced by **connect-equations in the equation part of a class**.
> A connect-equation has the following syntax: `connect "(" component-reference "," component-reference
> ")" ";"`"

There is no source, no sink, no direction in the construct.

### 1.7.2 The semantics are equality + zero-sum (MLS 3.6 §9.2) — this IS acausality

For each `connect(a, b)` the primitive components of `a` and `b` form a **connection set**. Then:

> "Each connection set is used to generate equations for **potential and flow (zero-sum)** variables of the
> form
> - `a1 = a2 = … = an` (neither flow nor stream variables)
> - `z1 + z2 + (-z3) + … + zn = 0` (flow variables)
>
> … the sign used for the connector variable `zi` above is **+1 for inside connectors and -1 for outside
> connectors**."

That is: **across variables are equated; through variables sum to zero** (Kirchhoff). Verbatim spec
example, `connect(load.p, ground.p); connect(resistor.p, ground.p);` produces:

```modelica
load.p.v  = load.resistor.p.v;
load.n.v  = load.resistor.n.v;
load.p.v  = ground.p.v;
load.p.v  = resistor.p.v;
0 = (-load.p.i) + load.resistor.p.i;
0 = (-load.n.i) + load.resistor.n.i;
0 = load.p.i + ground.p.i + resistor.p.i;
0 = load.n.i;
0 = resistor.n.i;
```

**Implication for the editor's data model:** a `connect` statement is *symmetric*. The editor must not
store, infer, or render a direction for it, and must not let the user's connection gesture ("I dragged from
A to B") leak into the persisted model, because `connect(a,b)` and `connect(b,a)` are semantically
identical up to sign of the flow terms and *are* equivalent in the generated equations. Rendering an
arrowhead on a connection in a Modelica diagram is a **stylistic** choice, not a semantic one — and it
would be actively misleading for acausal domains.

### 1.7.3 Connector classes, `flow`, and causality (MLS 3.6 §9.3.1, §9.3)

- A connector is "an instance of a **connector class**". Connector variables are either **flow** (`flow`
  prefix) or non-flow. §9.1.1: "A connection set shall contain either only flow variables or only
  non-flow variables."
- **Balancing restriction** (§9.3.1): "For each non-partial non-expandable connector class the number of
  flow variables shall be equal to the number of non-flow variables" (after expanding records/arrays to
  scalars) — with operator records counted via their `equalityConstraint()`.
- Connectors may also carry `input`/`output` prefixes, and the spec calls these **causal** variables:
  "**causal variables (`input`/`output`)** only to causal variables". Example in §9.3.1:
  `connector InputReal = input Real; // A causal input connector`.
- The spec's own terminology for the two worlds is visible in §18.5.2: "This annotation is intended for
  **non-causal connectors**, see section 9.3. It is particularly suited for stream connectors, see
  chapter 15." — i.e. the spec says "non-causal", the community says "acausal". Both refer to the
  flow/potential world.
- `expandable connector` (§9.1.3): non-parameter scalar variables and array elements are "marked as only
  being potentially present" and connections are *elaborated*: the expandable connector instance "is
  automatically augmented with a new component having the used name and corresponding type", and when two
  expandable connectors are connected "each is augmented with the variables that are only declared in the
  other… I.e., each of the connector instances is expanded to be the **union of all connector variables**."
  This is why a bus connection's `Line` annotation is one line while the *semantics* are N equations.
- `mustBeConnected = "message"` and `mayOnlyConnectOnce = "message"` are **connector component**
  annotations (§18.5.2) — relevant for validating diagrams.
- Overconstrained connectors and `Connections.root`/`potentialRoot`/`branch` etc. are §9.4; not covered in
  detail here but an editor should not assume a connection graph is always a forest.

### 1.7.4 Conditional connectors (MLS 3.6 §4.4.5)

A component may carry `if condition` (e.g. `Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a heatPort(...) if useHeatPort`).
Conditional "must be a scalar Boolean **evaluable** expression". "If `condition` is false, the component
(including its modifier) is removed from the flattened DAE, and **connections to/from the component are
removed**." An editor therefore must evaluate `if`-conditions using parameter bindings in order to know
which connectors exist — and `Placement(iconVisible=…)` is the related *visual* switch (§1.5).

## 1.8 Dynamic graphics: `DynamicSelect` (MLS 3.6 §18.6.6)

> "Any value in graphical annotations can be dependent on **evaluable parameters** except when restricted
> otherwise… `DynamicSelect` has the syntax of a function call with **two arguments**, where the first
> argument specifies the value of the **static** state and the second argument the value of the
> **dynamic** state. The first argument follows the same rules as when not using `DynamicSelect!`. The
> second argument **may contain references to variables of a higher variability** to enable displaying
> dynamic behavior of a simulation."

Spec example:

```modelica
annotation(Icon(graphics = {
  Rectangle(
    extent =
      DynamicSelect({{0, 0}, {20, 20}},
                    {{0, 0}, {20, level}}),
    fillColor =
      DynamicSelect({0, 0, 255},
                    if overflow then {255, 0, 0} else {0, 0, 255})
  )}));
```

MSL usage is real and widespread, e.g. `Modelica.Thermal.FluidHeatFlow.Components.OpenTank`:

```modelica
extent=DynamicSelect({{-80,0},{80,-80}}, ...),
textString=DynamicSelect("%level.start", String(...))
```

and `Modelica.StateGraph`:

```modelica
fillColor=DynamicSelect({255,255,255}, if active then {0,255,0} else {255,255,255}),
```

**Editor implication:** an editor that shows *animated* diagrams must be able to evaluate the second
argument against a result file, and it must fall back to the first argument otherwise. A static editor
needs only argument 1. Also: `DynamicSelect` values are not evaluable constants, so a strict
annotation-typing validator must special-case them.

## 1.9 Interactive diagram elements: the `interaction` annotation (MLS 3.6 §18.6.7)

This — not `Evaluate` — is the "interactive diagram manipulation" feature.

```modelica
InteractionItem[:] interaction;

partial record InteractionItem
end InteractionItem;
```

> "Allowed for components and class annotations, and also as an attribute of a `GraphicItem`. Each element
> of the `interaction` array specifies how some variable should be modified… the actions of modifying
> variables through these annotations **deviate from the mathematical formalism**… the critera for
> allowing a variable to be modified, as well as the semantics of the modification, are **tool-dependent**."

Concrete items:

```modelica
record OnMouseDownSetBoolean extends InteractionItem
  Boolean variable "Variable to change when mouse button pressed";
  Boolean value "Assigned value";
end OnMouseDownSetBoolean;

record OnMouseUpSetBoolean extends InteractionItem
  Boolean variable "Variable to change when mouse button released";
  Boolean value "Assigned value";
end OnMouseUpSetBoolean;

record OnMouseMoveXSetReal extends InteractionItem
  Real xVariable "Variable to change when cursor moved in x direction";
  Real minValue;
  Real maxValue;
end OnMouseMoveXSetReal;

record OnMouseMoveYSetReal extends InteractionItem   // analogous
record OnMouseDownEditInteger extends InteractionItem
  Integer variable "Variable to change";
end OnMouseDownEditInteger;

record OnMouseDownEditReal extends InteractionItem
  Real variable "Variable to change";
end OnMouseDownEditReal;

record OnMouseDownEditString extends InteractionItem
  String variable "Variable to change";
end OnMouseDownEditString;
```

> ⚠️ **`grep` finds ZERO `interaction` usage in MSL 4.2.0-dev.** So this is a spec feature with very thin
> real-world library usage. Treat it as low priority for a first editor version, but the *schema* must not
> be broken on round-trip.

## 1.10 The `Dialog` annotation (MLS 3.6 §18.7)

```modelica
record Dialog
  /*literal*/ constant String tab = "General";
  /*literal*/ constant String group = "";
  /*evaluable*/ parameter Boolean enable = true;
  /*literal*/ constant Boolean showStartAttribute;
  /*literal*/ constant Boolean colorSelector = false;
  /*literal*/ constant Selector loadSelector;
  /*literal*/ constant Selector saveSelector;
  /*literal*/ constant Selector directorySelector;
  /*literal*/ constant String groupImage = "";
  /*literal*/ constant Boolean connectorSizing = false;
end Dialog;

record Selector
  /*literal*/ constant String filter = "";
  /*literal*/ constant String caption = "";
end Selector;
```

Rules, quoted:

- Allowed for **component declarations and short replaceable class definitions**; for the latter only
  `tab`, `group`, `enable`, `groupImage` are allowed.
- "`tab` shall correspond to a major divisioning of 'tabs', and `group` correspond to sub-divisioning of
  'groups'… The order of components within each group and the order of the groups and tabs are according
  to the **declaration order**, where inherited elements are added at the place of the extends."
- "A component shall have **at most one** of `showStartAttribute=true`, `colorSelector=true`,
  `loadSelector`, `saveSelector`, `directorySelector`, or `connectorSizing=true`."
- `enable=false` ⇒ "the input field may be disabled and no input can be given."
- `showStartAttribute=true` ⇒ "the dialog should allow the user to set the **`start`- and `fixed`-attributes**
  for the variable instead of the value of the variable."
- `colorSelector=true` ⇒ "suggests the use of a color selector to pick an **RGB color as a vector of three
  values in the range 0..255**".
- `loadSelector`/`saveSelector` + `Selector(filter="text1 (*.ext1);;text2 (*.ext2)", caption="…")`;
  "`loadSelector` is used to select an existing file for reading, whereas `saveSelector` is used to define
  a file for writing."
- `directorySelector` selects an existing directory; "**The `filter` may not be used.**"
- `groupImage` "references an image using an URI… the image is intended to be shown together with the
  entire group (**only one image per group is supported**)"; transparent or white background recommended.
- `connectorSizing` — see §18.7.1.

Spec `Dialog` example (verbatim), which shows `group`, `tab`, and `enable` derived from a boolean parameter
(the exact idiom MSL uses everywhere):

```modelica
model DialogDemo
  parameter Boolean b = true "Boolean parameter";
  parameter Modelica.Units.SI.Length length "Real parameter with unit";
  parameter Real r1 "Real parameter in Group 1"
     annotation(Dialog(group = "Group 1"));
  parameter Real r2 "Disabled Real parameter in Group 1"
     annotation(Dialog(group = "Group 1", enable = not b));
  parameter Real r3 "Real parameter in Tab 1"
     annotation(Dialog(tab = "Tab 1"));
  parameter Real r4 "Real parameter in Tab 1 and Group 2"
     annotation(Dialog(tab = "Tab 1", group = "Group 2"));
  …
end DialogDemo;
```

### 1.10.1 `connectorSizing` (MLS 3.6 §18.7.1)

> "If `connectorSizing = false`, this annotation has no effect. A variable with `connectorSizing = true`
> must be declared with the `parameter` or `constant` prefix, must be a **subtype of a scalar `Integer`**
> and must have a **literal default value of `0`**."

This is what lets a graphical tool grow an array of connectors (e.g. a bus) as the user draws more
connections — directly relevant to an editor.

### 1.10.2 What does **not** live in `Dialog`

The brief also listed `Evaluate`, `unit`, `displayUnit`, `min`, `max`, `quantity`, `stateSelect`. Verified
against MLS 3.6:

| Item | Where it actually lives |
|---|---|
| `Evaluate` | **§18.3 Symbolic Processing** — separate annotation: `/*literal*/ constant Boolean Evaluate;` "only allowed for parameters and constants". `true` ⇒ "must be an evaluated parameter (i.e. its value must be determined during translation, similar to a constant)". `false` ⇒ "ensures that the parameter is a **non-evaluable** parameter". Used e.g. "for axis of rotation parameters in `Modelica.Mechanics.MultiBody`". |
| `unit`, `displayUnit`, `min`, `max`, `quantity`, `stateSelect`, `start`, `fixed`, `nominal`, `unbounded` | **Ch. 4 built-in variable attributes** (`real-attribute` etc.), *not* annotations. `displayUnit` is what `%par` substitution must use (§1.4.5). |
| `choices`, `choicesAllMatching` | **§7.3.4** (cross-referenced from §18.11) — see below. |

### 1.10.3 `choices` / `choicesAllMatching` (MLS 3.6 §7.3.4)

```modelica
"choices" "(" [ choices-argument { "," choice } ] ")"
choices-argument : "choice" modification | "checkBox" "=" true
```

> "A declaration can have a `choices` annotation containing modifiers for `choice`, where each of them
> indicates a **suitable redeclaration or modification** of the element. This is a hint for users of the
> model, and can also be used by the **user interface to suggest reasonable redeclarations**, where the
> string comment on each `choice` modifier can be used as explanation of that choice. The annotation is
> **not restricted to replaceable elements** but can also be applied to non-replaceable elements,
> enumeration types, and simple variables."

Also: `choicesAllMatching = true` is a `Boolean` annotation that requests "an **automatically generated** list
of redeclarations", and for a `Boolean` variable `choices` may contain `checkBox = true`. A new editor's
component/redeclare dialogs should honour both. MSL example
(`Modelica.Utilities.Internal`): `annotation(choicesAllMatching=true, Dialog(group="Surface properties"));`

## 1.11 Vendor-specific annotations and `__OpenModelica_*` (MLS 3.6 §18.1)

> "A vendor may – **anywhere inside an annotation** – add specific, possibly undocumented, annotations which
> are **not intended to be interpreted by other tools**. The only requirement is that **any tool shall save
> files with all vendor-specific annotations (and all annotations from this chapter) intact.** Two variants
> exist; one simple and one hierarchical. **Double underscore concatenated with a vendor name** as initial
> characters of the identifier are used to identify vendor-specific annotations."

Spec examples:

```modelica
annotation(
  Icon(coordinateSystem(extent = {{-100, -100}, {100, 100}}),
       graphics = {__NameOfVendor(Circle(center = {0, 0}, radius = 10))}));
```
"This introduces a **new graphical primitive** `Circle` using the **hierarchical** variant…"

```modelica
annotation(
  Icon(coordinateSystem(extent = {{-100, -100}, {100, 100}}),
       graphics = {Rectangle(extent = {{-5, -5}, {7, 7}},
                             __NameOfVendor_shadow = 2)}));
```
"This introduces a new **attribute** `__NameOfVendor_shadow` for the `Rectangle` primitive using the
**simple** variant."

> ### ⚠️ Hard requirement for a new editor
> **Preserve unknown vendor annotations verbatim on round-trip.** This is not a nicety — it is the single
> normative obligation the spec places on every tool. That means the Modelica parser must retain the full
> annotation tree (including unknown record names and unknown fields), and the writer must reproduce it.
> A lossy "parse into my own shape classes" design will silently corrupt vendor metadata in every library
> it touches.

**OpenModelica's concrete vendor annotations** (documented in the OpenModelica User's Guide,
<https://raw.githubusercontent.com/OpenModelica/OpenModelica/master/doc/UsersGuide/source/omedit.rst>):

```modelica
model Test
  annotation(__OpenModelica_commandLineOptions =
     "--matchingAlgorithm=BFSB --indexReductionMethod=dynamicStateSelection");
end Test;

model Test2
  annotation(__OpenModelica_simulationFlags(s = "ida", cpu = "()"));
end Test2;
```

> "`__OpenModelica_commandLineOptions` — OpenModelica specific annotation to define the command line
> options needed to simulate the model… The annotation is a **space separated list** of options where each
> option is either just a command line flag or a flag with a value."
> "`__OpenModelica_simulationFlags` — … a **comma separated list** of options where each option is a
> simulation flag with a value. **For flags that doesn't have any value use `()`**."

Both can be ignored via `--ignoreCommandLineOptionsAnnotation=true` /
`--ignoreSimulationFlagsAnnotation=true`. **Note the asymmetry** (`commandLineOptions` = space-separated
string; `simulationFlags` = record-like comma-separated list) — easy to get wrong.

`grep -rn "__OpenModelica" Modelica/` over MSL 4.2.0-dev returns **0 hits**; this is a user-model
annotation, not a library convention.

## 1.12 The `uses` annotation (MLS 3.6 §18.8.2)

```
"uses" "(" [ used-package { "," used-package } ] ")"
used-package :
  IDENT "(" "version" "=" PACKAGE-VERSION
    [ "," "versionBuild" "=" UNSIGNED-INTEGER ]
    [ "," "dateModified" "=" STRING ] ")"
```

> "`uses(otherPackage(version = otherPackageVersion))` defines that classes within this top-level class
> **use the `otherPackageVersion` of classes within the top-level class `otherPackage`**."

It is a **top-level package** annotation and is what a tool uses to resolve library versions. MSL itself,
verbatim from `Modelica/package.mo` (master = 4.2.0 dev):

```modelica
version="4.2.0 dev",
versionDate="20xx-xx-xx",
uses(Complex(version="4.2.0 dev"), ModelicaServices(version="4.2.0 dev")),
conversion(
  from(version={"3.0","3.0.1","3.1","3.2","3.2.1","3.2.2","3.2.3"},
       script="modelica://Modelica/Resources/Scripts/Conversion/ConvertModelica_from_3.2.3_to_4.0.0.mos")),
```

An editor that loads libraries must parse `uses` (and `version`/`conversion`) to pick the right library
versions. Note that MSL 4.x depends on a **separate `Complex` package** — a real-world dependency edge.

## 1.13 MSL conventions in practice — actual source

### 1.13.1 `Modelica.Electrical.Analog.Basic.Resistor` — Icon only, **no Diagram layer**

Verbatim annotation block (identical in MSL **v4.0.0** and master **4.2.0-dev**):

```modelica
  annotation (
    Documentation(info="<html>
<p>The linear resistor connects the branch voltage <em>v</em> with the branch current <em>i</em> by <em>i*R = v</em>. The Resistance <em>R</em> is allowed to be positive, zero, or negative.</p>
</html>", revisions="<html>…</html>"),
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,
            100}}), graphics={
        Rectangle(
          extent={{-70,30},{70,-30}},
          lineColor={0,0,255},
          fillColor={255,255,255},
          fillPattern=FillPattern.Solid),
        Line(points={{-90,0},{-70,0}}, color={0,0,255}),
        Line(points={{70,0},{90,0}}, color={0,0,255}),
        Text(
          extent={{-150,-40},{150,-80}},
          textString="R=%R"),
        Line(
          visible=useHeatPort,
          points={{0,-100},{0,-30}},
          color={127,0,0},
          pattern=LinePattern.Dot),
        Text(
          extent={{-150,90},{150,50}},
          textString="%name",
          textColor={0,0,255})}));
end Resistor;
```

Teaching points, all directly usable as editor test cases:

1. **The classic MSL box-with-leads icon**: a `Rectangle` body plus two short `Line` leads at ±90.
2. **The Diagram layer is absent.** `Resistor` inherits `extends Modelica.Electrical.Analog.Interfaces.OnePort;`
   and has no `Diagram(...)` at all — so in the diagram view the tool falls back to §18.6.2.1's
   "rudimentary outline" *unless* a base class supplies graphics. The brief's assumption that there is a
   Resistor "Diagram layer" is **not** borne out by the source.
3. **`%R` macro** in `Text` — the editor must substitute the *modified* value (e.g. `R=100`) and format
   with `displayUnit`.
4. **`visible=useHeatPort`** on a `Line` — conditional graphics driven by a parameter, matching the
   conditional connector `heatPort ... if useHeatPort` in
   `Modelica.Electrical.Analog.Interfaces.ConditionalHeatPort`:
   ```modelica
   parameter Boolean useHeatPort = false "= true, if heatPort is enabled"
     "Fixed device temperature if useHeatPort = false" annotation(Dialog(enable=not useHeatPort));
   Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a heatPort(final T=T_heatPort, final Q_flow=-LossPower) if useHeatPort
   ```
   **The `visible` expression and the connector's `if` condition must be kept in sync** — MSL relies on
   the author doing this by hand. An editor offering a "toggle conditional port" UI must edit both.
5. **`Text` extents may extend outside the coordinate system** (`{{-150,-40},{150,-80}}` vs the
   `{{-100,-100},{100,100}}` coordinate system) — the spec explicitly permits graphics outside the extent
   (cf. FMI §2.4.9.1.1: "graphical items may exceed that rectangle").

### 1.13.2 Rotating machinery icon — `Modelica.Mechanics.Rotational.Components.Inertia`

Verbatim (MSL master, 4.2.0-dev):

```modelica
       Icon(
  coordinateSystem(preserveAspectRatio=true,
    extent={{-100.0,-100.0},{100.0,100.0}}),
  graphics={
    Rectangle(lineColor={64,64,64},
      fillColor={192,192,192},
      fillPattern=FillPattern.HorizontalCylinder,
      extent={{-100.0,-10.0},{-50.0,10.0}}),
    Rectangle(lineColor={64,64,64},
      fillColor={192,192,192},
      fillPattern=FillPattern.HorizontalCylinder,
      extent={{50.0,-10.0},{100.0,10.0}}),
    Line(points={{-80.0,-25.0},{-60.0,-25.0}}),
    Line(points={{60.0,-25.0},{80.0,-25.0}}),
    Line(points={{-70.0,-25.0},{-70.0,-70.0}}),
    Line(points={{70.0,-25.0},{70.0,-70.0}}),
    Line(points={{-80.0,25.0},{-60.0,25.0}}),
    Line(points={{60.0,25.0},{80.0,25.0}}),
    Line(points={{-70.0,45.0},{-70.0,25.0}}),
    Line(points={{70.0,45.0},{70.0,25.0}}),
    Line(points={{-70.0,-70.0},{70.0,-70.0}}),
    Rectangle(lineColor={64,64,64},
      fillColor={255,255,255},
      fillPattern=FillPattern.HorizontalCylinder,
      extent={{-50.0,-50.0},{50.0,50.0}},
      radius=10.0),
    Text(textColor={0,0,255},
      extent={{-150.0,60.0},{150.0,100.0}},
      textString="%name"),
    Text(extent={{-150.0,-120.0},{150.0,-80.0}},
      textString="J=%J"),
    Rectangle(
      lineColor = {64,64,64},
      fillColor = {255,255,255},
      extent = {{-50,-50},{50,50}},
      radius = 10)}));
```

(That final duplicate `Rectangle` is present verbatim in MSL master — a real-world example of redundant
overlapping geometry that an editor's round-trip must not "clean up" silently.)

Teaching points: `FillPattern.HorizontalCylinder` with `fillColor={192,192,192}` / `lineColor={64,64,64}`
is *the* MSL idiom for "shaft/cylinder"; `radius=10` gives the rounded hub; symmetric line-work for the
flange markers; two `Text` macros (`%name`, `%J`). Note also `Inertia` has **no `Diagram` annotation**.

### 1.13.3 How CONNECTORS are drawn — the connector class's own `Icon`

A connector's appearance comes from the `Icon`/`Diagram` annotations **on the connector class itself**
(§18.6.2: "For a connector component, the component's **diagram layer** defines the content to be
displayed, while the **icon layer** is used for other component kinds").

**`Modelica.Electrical.Analog.Interfaces.Pin`** — Icon = filled rectangle, Diagram = smaller filled
rectangle + name text (verbatim, MSL master):

```modelica
  annotation (defaultComponentName="pin",
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,
            100}}), graphics={Rectangle(
          extent={{-100,100},{100,-100}},
          lineColor={0,0,255},
          fillColor={0,0,255},
          fillPattern=FillPattern.Solid)}),
    Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{
            100,100}}), graphics={Rectangle(
          extent={{-40,40},{40,-40}},
          lineColor={0,0,255},
          fillColor={0,0,255},
          fillPattern=FillPattern.Solid), Text(
          extent={{-160,110},{40,50}},
          textColor={0,0,255},
          textString="%name")}),
    Documentation(…));
```

**`Modelica.Mechanics.Rotational.Interfaces.Flange`** — the *base* connector has **no icon at all**
("It has no icon definition and is only used by inheritance from flange connectors to define different
icons."). The circle-and-fork visuals live on `Flange_a` / `Flange_b`, which differ **only** in `fillColor`:

`Flange_a.mo` (verbatim):

```modelica
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
      Ellipse(
        extent={{-100,100},{100,-100}},
        fillColor={95,95,95},
        fillPattern=FillPattern.Solid)}),
    Diagram(coordinateSystem(
        preserveAspectRatio=true,
        extent={{-100,-100},{100,100}}), graphics={Text(
              extent={{-160,90},{40,50}},
              textString="%name"),Ellipse(
              extent={{-40,40},{40,-40}},
              fillColor={135,135,135},
              fillPattern=FillPattern.Solid)}));
```

`Flange_b.mo` (verbatim) — identical except `fillColor={255,255,255}` in `Icon` and the `Text`/`Ellipse`
order swapped in `Diagram`:

```modelica
    Icon(coordinateSystem(
        preserveAspectRatio=true,
        extent={{-100,-100},{100,100}}), graphics={Ellipse(
              extent={{-100,100},{100,-100}},
              fillColor={255,255,255},
              fillPattern=FillPattern.Solid)}),
    Diagram(coordinateSystem(
        preserveAspectRatio=true,
        extent={{-100,-100},{100,100}}), graphics={Ellipse(
              extent={{-40,40},{40,-40}},
              fillColor={255,255,255},
              fillPattern=FillPattern.Solid),Text(
              extent={{-40,90},{160,50}},
              textString="%name")}));
```

> Note the naming caveat in the brief: `Modelica.Mechanics.Rotational.Interfaces.Flange` does **not** draw
> "a circle+fork". It draws nothing. `Flange_a`/`Flange_b` draw a **filled grey / hollow white Ellipse**.
> Both carry `defaultComponentName` (`"flange_a"` / `"flange_b"`) — the class annotation an editor uses to
> auto-name a dropped component.

**`Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a`** — the same pattern with the thermal red colour
`{191,0,0}` and an explicit note that the two connector classes differ *only* in icon:

```modelica
  annotation(defaultComponentName = "port_a",
    Documentation(info="<html>… Note, that the two connector classes <strong>HeatPort_a</strong> and
<strong>HeatPort_b</strong> are identical with the only exception of the different
<strong>icon layout</strong>.</html>"),
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
          extent={{-100,100},{100,-100}},
          lineColor={191,0,0},
          fillColor={191,0,0},
          fillPattern=FillPattern.Solid)}),
    Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
          extent={{-50,50},{50,-50}},
          lineColor={191,0,0},
          fillColor={191,0,0},
          fillPattern=FillPattern.Solid), Text(
          extent={{-120,120},{100,60}},
          textColor={191,0,0},
          textString="%name")}));
```

**Causal connectors are drawn as arrows — via `Polygon`, not via `Line.arrow`.** `Modelica.Blocks.Interfaces.RealInput`
(MSL master, in `Modelica/Blocks/Interfaces.mo`):

```modelica
connector RealInput = input Real "'input Real' as connector" annotation (
    defaultComponentName="u",
    Icon(graphics={
      Polygon(
        lineColor={0,0,127},
        fillColor={0,0,127},
        fillPattern=FillPattern.Solid,
        points={{-100.0,100.0},{100.0,0.0},{-100.0,-100.0}})},
      coordinateSystem(extent={{-100.0,-100.0},{100.0,100.0}},
        preserveAspectRatio=true,
        initialScale=0.2)),
    Diagram(
      coordinateSystem(preserveAspectRatio=true,
        initialScale=0.2,
        extent={{-100.0,-100.0},{100.0,100.0}}),
        graphics={
      Polygon(
        lineColor={0,0,127},
        fillColor={0,0,127},
        fillPattern=FillPattern.Solid,
        points={{0.0,50.0},{100.0,0.0},{0.0,-50.0},{0.0,50.0}}),
      Text(
        textColor={0,0,127},
        extent={{-10.0,60.0},{-10.0,85.0}},
        textString="%name")}),
    Documentation(info="…"));
```

> ⚠️ **This is a subtle correctness trap.** The *visual* arrow direction of a `Modelica.Blocks` signal
> connector is baked into the `Polygon` geometry and the `transformation.rotation` of the *component*, not
> into any semantic field. It is pure convention. Meanwhile, in an **acausal** `Modelica.Electrical.Analog`
> or `Modelica.Mechanics.Rotational` diagram, connector icons are symmetric rectangles/ellipses and signal
> direction genuinely does not exist. An editor that infers "flow direction" from the rendered arrowhead
> will be *right* for `Modelica.Blocks` and *meaningless* for physical connectors. Direction must be read
> from the language (`input`/`output` prefixes, `flow` prefix), never from pixels.

### 1.13.4 `Bitmap` in real MSL — `fileName` with a `modelica://` URI

`Modelica.Thermal.HeatTransfer.Examples.Utilities.InverseCapacity` (verbatim excerpt) — note the icon
mixes `Text` and `Bitmap`, uses `preserveAspectRatio=false`, and uses `TextAlignment.Left`:

```modelica
  annotation (Icon(coordinateSystem(
          preserveAspectRatio=false, extent={{-100,-100},{100,100}}),
        graphics={Text(extent={{0,-62},{96,-94}}, textColor={135,135,135}, textString="to FMU"),
                  Text(extent={{-94,96},{-10,66}}, horizontalAlignment=TextAlignment.Left, textString="T"),
                  Text(extent={{-94,46},{-10,16}}, horizontalAlignment=TextAlignment.Left, textString="dT"),
                  Text(extent={{-150,-110},{150,-140}}, textString="C=%C"),
                  Bitmap(extent={{-58,-42},{98,48}},
                    fileName="modelica://Modelica/Resources/Images/Thermal/HeatTransfer/InverseCapacity.png"),
                  Text(extent={{-90,-64},{-6,-94}}, horizontalAlignment=TextAlignment.Left, textString="Q_flow")}));
```

The `modelica://Modelica/Resources/Images/...` URI convention (MLS §13.5) is what a web editor must
resolve — via the library's `package.mo` root — and serve as an asset.

### 1.13.5 A class that DOES have a `Diagram` layer — `Modelica.Mechanics.Translational.Interfaces.Support`

Connectors commonly define both layers, with the diagram version scaled down and colour-harmonised:

```modelica
  annotation (
    Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
        Rectangle(extent={{-60,60},{60,-60}},
          fillColor={175,190,175}, fillPattern=FillPattern.Solid, pattern=LinePattern.None),
        Text(extent={{-160,110},{40,50}}, textColor={0,127,0}, textString="%name"),
        Rectangle(extent={{-40,-40},{40,40}},
          lineColor={0,127,0}, fillColor={0,127,0}, fillPattern=FillPattern.Solid)}),
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
        Rectangle(extent={{-90,-90},{90,90}},
          lineColor={0,127,0}, fillColor={175,175,175}, fillPattern=FillPattern.Solid),
        Rectangle(extent={{-150,150},{150,-150}},
          fillColor={175,190,175}, fillPattern=FillPattern.Solid, pattern=LinePattern.None),
        Rectangle(extent={{-90,-90},{90,90}},
          lineColor={0,127,0}, fillColor={0,127,0}, fillPattern=FillPattern.Solid)}),
    Documentation(info="…"));
```

Note `pattern=LinePattern.None` to draw a pure fill, and the **overlapping-rectangles z-order** idiom in
the Icon (a large pale backdrop, then the coloured body, then an inner fill) — this only works if primitives
are painted strictly in array order (§1.1).

---

# PART 2 — Existing Modelica / physical-simulation GUI editors and their rendering tech

## 2.1 OpenModelica OMEdit — **the reference open-source Modelica diagram editor**

### Rendering technology: **Qt Graphics View Framework (`QGraphicsScene` + `QGraphicsView`) with `QPainter`**

Verified directly from the OMEdit source (not from documentation claims). In
`OMEdit/OMEditLIB/Modeling/ModelWidgetContainer.cpp`:

```cpp
/**
 * \class GraphicsScene
 * \brief The GraphicsScene class is a container for graphical components in a simulation model.
 */
GraphicsScene::GraphicsScene(StringHandler::ViewType viewType, ModelWidget *pModelWidget)
  : QGraphicsScene(pModelWidget), mViewType(viewType)
...
/**
 * \class GraphicsView
 * \brief The GraphicsView class is a class which display the content of a scene of components.
 */
GraphicsView::GraphicsView(StringHandler::ViewType viewType, ModelWidget *pModelWidget)
  : QGraphicsView(pModelWidget), mViewType(viewType), mSkipBackground(false), ...
  setDragMode(QGraphicsView::RubberBandDrag);
  setViewportUpdateMode(QGraphicsView::FullViewportUpdate);
```

and in `OMEdit/OMEditLIB/Annotations/ShapeAnnotation.h`:

```cpp
#include <QGraphicsItem>
class ShapeAnnotation : public QObject, public QGraphicsItem, public GraphicItem, public FilledShape
{
  Q_INTERFACES(QGraphicsItem)
```

Painting is `QPainter`-based (the Qt Graphics View default): `setRenderHint(QPainter::SmoothPixmapTransform);`
and `painter.setRenderHints(QPainter::Antialiasing | QPainter::SmoothPixmapTransform);` in
`ModelWidgetContainer.cpp`. **No OpenGL / QtQuick / WebEngine is used for the diagram view.**
The OpenModelica User's Guide confirms the stack at a high level: "It is implemented in **C++ using the Qt
graphical user interface library**"
(<https://raw.githubusercontent.com/OpenModelica/OpenModelica/master/doc/UsersGuide/source/omedit.rst>).

### Architecture: one C++ class per annotation attribute type

`OMEdit/OMEditLIB/Annotations/` contains a class per Modelica annotation attribute — this is effectively a
typed, default-eliding Modelica-annotation object model:

```
ArrowAnnotation      BitmapAnnotation     BooleanAnnotation   BorderPatternAnnotation
ColorAnnotation      DynamicAnnotation    EllipseAnnotation   EllipseClosureAnnotation
ExtentAnnotation     FillPatternAnnotation LineAnnotation     LinePatternAnnotation
PointAnnotation      PointArrayAnnotation  PolygonAnnotation   RealAnnotation
RectangleAnnotation  ShapeAnnotation       SmoothAnnotation    StringAnnotation
TextAlignmentAnnotation TextAnnotation      TextStyleAnnotation …
```

Note **`DynamicAnnotation`** — a dedicated wrapper for `DynamicSelect(static, dynamic)` values, and the
pervasive `isDynamicSelectExpression()` check in every serializer. This is a good architectural model for a
web editor: model each attribute as a typed value that is *either* a literal *or* a `DynamicSelect`
expression.

### How OMEdit serializes a `Line` — a reference implementation

`OMEdit/OMEditLIB/Annotations/LineAnnotation.cpp`, verbatim:

```cpp
QString LineAnnotation::getShapeAnnotation()
{
  QStringList annotationString;
  annotationString.append(GraphicItem::getShapeAnnotation());
  // get points
  if (mPoints.size() > 0) {
    annotationString.append(QString("points=%1").arg(mPoints.toQString()));
  }
  // get the line color
  if (mLineColor.isDynamicSelectExpression() || mLineColor.toQString().compare(QStringLiteral("{0,0,0}")) != 0) {
    annotationString.append(QString("color=%1").arg(mLineColor.toQString()));
  }
  // get the line pattern
  if (mLinePattern.isDynamicSelectExpression() || mLinePattern.toQString().compare(QStringLiteral("LinePattern.Solid")) != 0) {
    annotationString.append(QString("pattern=%1").arg(mLinePattern.toQString()));
  }
  // get the thickness
  if (mLineThickness.isDynamicSelectExpression() || mLineThickness.toQString().compare(QStringLiteral("0.25")) != 0) {
    annotationString.append(QString("thickness=%1").arg(mLineThickness.toQString()));
  }
  // get the start and end arrow
  if (mArrow.isDynamicSelectExpression() || mArrow.toQString().compare(QStringLiteral("{Arrow.None,Arrow.None}")) != 0) {
    annotationString.append(QString("arrow=%1").arg(mArrow.toQString()));
  }
  // get the arrow size
  if (mArrowSize.isDynamicSelectExpression() || mArrowSize.toQString().compare(QStringLiteral("3")) != 0) {
    annotationString.append(QString("arrowSize=%1").arg(mArrowSize.toQString()));
  }
  // get the smooth
  if (mSmooth.isDynamicSelectExpression() || mSmooth.toQString().compare(QStringLiteral("Smooth.None")) != 0) {
    annotationString.append(QString("smooth=%1").arg(mSmooth.toQString()));
  }
  return QString("Line(").append(annotationString.join(",")).append(")");
}
```

**This independently confirms every parameter-name correction in §0:**
`thickness` (a single value), `arrow` (written as the two-element array `{Arrow.None,Arrow.None}`), and
`arrowSize` (a single value). **And it reveals the likely source of the "`lineThickness` on `Line`"
confusion:** OMEdit's *C++ member variable* is called `mLineThickness` for **both** `Line.thickness` and
`FilledShape.lineThickness` (`FilledShape::setDefaults() { … mLineThickness = 0.25; }`), and
`ShapeAnnotation.cpp` emits `lineThickness=` only for filled shapes:

```cpp
annotationString.append(QString("lineThickness=%1").arg(mLineThickness.toQString()));
```

Base-class serializer (`GraphicItem::getShapeAnnotation`), verbatim:

```cpp
  /* get visible */
  if (mVisible.isDynamicSelectExpression() || mVisible.toQString().compare(QStringLiteral("true")) != 0) { … "visible=…" }
  /* get origin */   … "{0,0}"  → "origin=…"
  /* get rotation */ … "0"      → "rotation=…"
```

**Two behaviours worth copying or deliberately not copying:**

1. **Default elision.** OMEdit only writes a field when it differs from the spec default. This makes its
   output minimal and readable — but it means **explicitly-written default values are dropped on
   round-trip**. That is a normalization, not a faithful round-trip.
2. **OMEdit also has a JSON serialization** of the same data (`LineAnnotation::getShapeAnnotationJSON()`
   → `{"Line": {"points":…, "color":…, "pattern":…, "thickness":…, "arrow":…, "arrowSize":…, "smooth":…},
   "Text": {…}}`). A useful precedent for a web editor's internal model, though note it is **OMEdit's own
   format, not a standard**.

### OMEdit does NOT write Modelica source itself — it delegates to the OMC API

`LineAnnotation::updateConnectionAnnotation()`, verbatim:

```cpp
void LineAnnotation::updateConnectionAnnotation()
{
  // get the connection line annotation.
  QString annotationString = QString("annotate=$annotation(%1)").arg(getShapeAnnotation());
  // update the connection
  OMCProxy *pOMCProxy = MainWindow::instance()->getOMCProxy();
  pOMCProxy->updateConnection(mpGraphicsView->getModelWidget()->getLibraryTreeItem()->getNameStructure(),
                              getStartElementName(), getEndElementName(), annotationString);
}
```

**Architectural consequence:** OMEdit mutates the model through the OpenModelica Compiler's scripting API
(`updateConnection(className, startConnector, endConnector, "annotate=$annotation(Line(...))")`), and OMC
owns the AST and the pretty-printing. This is why OMEdit does not need a lossless hand-written Modelica
writer — a browser editor without a server-side OMC will have to own that problem itself (see §2.2 and
Part 3 for the consequences).

`LineAnnotation` is constructed directly from the parsed model, confirming connections carry their
annotation in the AST:

```cpp
LineAnnotation::LineAnnotation(ModelInstance::Connection *pConnection, Element *pStartComponent,
                               Element *pEndComponent, bool inherited, GraphicsView *pGraphicsView)
  ...
  mpLine = pConnection->getAnnotation()->getLine();
```

### Connection routing: OMEdit FORCES orthogonal (Manhattan) routes

`ShapeAnnotation::manhattanizeShape()`, verbatim excerpt:

```cpp
void ShapeAnnotation::manhattanizeShape(bool addToStack)
{
  if (mSmooth == StringHandler::SmoothBezier) {
    return;
  }
  ...
    if (dx == 0) {
      points.append(QPointF(startPoint.x(), startPoint.y() + dy));
    } else if (dy == 0) {
      points.append(QPointF(startPoint.x() + dx, startPoint.y()));
    } else {
      points.append(QPointF(startPoint.x(), startPoint.y() + dy));
      points.append(QPointF(points[0].x() + dx, points[0].y()));
    }
```

i.e. any diagonal segment is replaced by an L-shaped pair of axis-aligned segments. It is invoked from
`LineAnnotation::updateStartPoint()` / `updateEndPoint()`, so **dragging a connection endpoint rewrites a
diagonal `Line` into an orthogonal polyline** — except for `Smooth.Bezier` lines, which are skipped.

> ⚠️ **Round-trip fidelity hazard for a new editor.** MSL and hand-written models *do* contain diagonal
> connection segments (e.g.
> `Line(points={{-80,-10},{-80,-14.5},{-79,-14.5},{-79,-17},{-65,-17},{-65,-65},{-25,-65}})`). If you
> copy OMEdit's routing behaviour without an opt-out, opening and nudging a library model will silently
> rewrite its connection geometry. Decide explicitly whether orthogonalisation is a *user command* or an
> *automatic side effect*.

### OMEdit's diagram/icon editing feature set (from the OMEdit User Guide)

- **Shape tools match the spec's six primitives exactly**: Line, Polygon, Rectangle, Ellipse, Text, Bitmap.
  "The shapes created on the Diagram View of Model Widget are part of the diagram and the shapes created on
  the Icon View will become the icon representation of the model."
- OMEdit's own **round-trip example** of what it writes (verbatim from the User Guide):
  ```modelica
  model testModel
    annotation(Icon(graphics = {Rectangle(rotation = 0, lineColor = {0,0,255}, fillColor = {0,0,255},
      pattern = LinePattern.Solid, fillPattern = FillPattern.None, lineThickness = 0.25,
      extent = {{ -64.5,88},{63, -22.5}}), Polygon(points = {{ -47.5, -29.5},{52.5, -29.5},{4.5, -86},
      { -47.5, -29.5}}, rotation = 0, lineColor = {0,0,255}, fillColor = {0,0,255},
      pattern = LinePattern.Solid, fillPattern = FillPattern.None, lineThickness = 0.25)}));
  end testModel;
  ```
  Note this writes `rotation = 0` and `lineThickness` on `Rectangle`/`Polygon` — **correct**.
- **Line Style Options** dialog exposes: *Color*, *Pattern*, *Thickness*, ***Start Arrow***, ***End
  Arrow***, ***Arrow Size*** ("Sets the start and end arrow size"), *Smooth*. ⚠️ **This GUI is the only
  place "start/end arrow size" appears** — the persisted annotation still has one `arrow[2]` and one
  `arrowSize` (§0).
- **Diagrams are drawn in the icon and diagram layers only**; `View ▸ Grid Lines`, *Reset Zoom*,
  *Zoom In/Out*, *Fit to Diagram*; "Making Connections" requires explicitly enabling a connect mode from
  the toolbar, then press-drag-release — the gesture order is **not persisted** (§1.7.2).
- **Interactive simulation is explicitly experimental**: "Interactive simulation is enabled by selecting
  interactive simulation in the simulation setup… **Warning: Interactive simulation is an experimental
  feature.**" Two modes, asynchronous and synchronous (step) — relevant if the web editor aims at
  `interaction`/`DynamicSelect` animation.
- **3D visualization** (multibody animation from a result file, plus realtime FMU animation) is a
  *separate* window (`+d=visxml` scene description), not part of the diagram editor.
- **SSP editing is first-class**: *File ▸ New ▸ New SSP Model*, an SSP menu (Add System, Add/Edit Icon,
  Delete Icon, Add Connector, Add Bus, Add TLM Bus, Add SubModel), OMSimulator/SSP options. In
  `LineAnnotation.cpp` the code branches on `isSSP()` → `updateOMSConnection()` instead of
  `updateConnectionAnnotation()`.
- **Export/import**: FMU import/export (FMI 1.0 deprecated / 2.0 / 3.0 experimental), Modelica→XML export,
  Figaro export, image export, encrypted packages, "Save Total".
- **Language server**: OMEdit can attach to an external Modelica language server over LSP —
  `OpenModelica/modelica-language-server`, installed under `share/omedit/ls/modelica`. See §2.2.5.

**Verified / unverified.** ✅ Every code snippet above was fetched from
`https://raw.githubusercontent.com/OpenModelica/OpenModelica/master/OMEdit/…` and the User Guide RST.
⚠️ The exact `Modelica`/`master` commit SHA was not pinned, so line numbers may drift; the quoted code is
accurate as fetched. ⚠️ Whether OMEdit uses OpenGL for the *3D animation* window (a separate component,
likely OMSimulator/OMVisualization) was **not** verified.

## 2.2 Other web-based Modelica editors and browser-side Modelica technology

### 2.2.1 OMWebEdit — **an archived browser Modelica diagram editor, and the closest reusable precedent**

- **Repo:** [`anuragkapur/OMWebEdit`](https://github.com/anuragkapur/OMWebEdit), 97 commits, **last commit
  2020-09-15, repo marked "Archived"**.
  > ⚠️ **`OpenModelica/OMWebEdit` does not exist** (404 on `main` and `master`). The fork's README badge
  > links to that dead path. Only `OpenModelica/OMWebService` exists in the OpenModelica org.
- **Rendering technology — verified from `package.json`**
  (<https://raw.githubusercontent.com/anuragkapur/OMWebEdit/master/package.json>): Create React App
  (`react-scripts` 3.4.1), React 16.13, **TypeScript 3.7**, and critically
  **`@projectstorm/react-diagrams` ^6.0.1-beta.7** — an **SVG-based** React diagramming library — plus
  `dagre` (layout), `paths-js` (SVG path generation), `pathfinding` (A\* routing), `ml-matrix`,
  `closest`, `@emotion/core`+`styled`. Tests: React Testing Library + Cypress. Deploy: Serverless
  Framework → S3.
  → **This is a Modelica diagram editor in React rendering via react-diagrams (SVG), not Canvas/WebGL.**
  That is a directly reusable architectural precedent.
- **README, verbatim:** "OpenModelica connection editor in the browser"; "The OMWebEdit will be the
  front-end (running in the browser) and OMWebService will be the backend (on some external server)."
  Stated requirements: "Should support drag-and-drop (and textual) composition of: Modelica models,
  composite FMU models (SSP)". A three-phase plan: (1) simulate existing models (no text), (2) compose
  models (drag-drop components/FMUs, edit params), (3) collaborative text editing incl. icons. Diagramming
  frameworks considered: `diagrams.net`, `jgraph/drawio`, `jgraph/drawio-desktop`.
- **Backend:** [`OpenModelica/OMWebService`](https://github.com/OpenModelica/OMWebService) — "OpenModelica
  web service, queries via a **REST API**"; Python ≥3.8.5 + **OpenModelica ≥1.19.0**; Flask
  (`Service/app.py`); Docker image `openmodelica/omwebservice`.
- ⚠️ **UNVERIFIED: how far the plan was completed.** README items are unchecked checkboxes and no releases
  were found. Treat as **an abandoned prototype**, not a working product.

### 2.2.2 Modelon Impact — **the most relevant *commercial* precedent**

**(a) It is browser-based.** Modelon system requirements, verbatim
(<https://help.modelon.com/latest/guides/system_requirements_general/>):

> "**Modelon Impact is a browser-based tool. Its graphical user interface is accessible through a web
> browser pointed at the correct address (URL)**; the URL could be `http://localhost:8080` for desktop
> installations or `http://impact.domain-name.com` for Self-managed installations."
> "Currently, the only officially supported web browser is **Google Chrome (the three most recent major
> versions)**… **Modelon Impact uses modern web technology.**"

A separate community doc states: "Modelon Impact requires no software to be installed on your client PCs.
To access Modelon Impact, you need a web browser. Compatible browsers are Chrome or other browsers based on
Chromium." (<https://modelon-community.github.io/customer-hosted-modelon-impact/whatsneeded.html>). Server
side: Ubuntu 22.04 LTS + Docker + Kubernetes. The **Desktop edition is End-of-Life**.

**(b) Client architecture — the key primary source.** The canonical statement is the Modelon-authored
paper: H. Elmqvist, M. Malmheden, J. Andreasson, **"A Web Architecture for Modeling and Simulation"
(WAMS)**, 2nd Japanese Modelica Conference, May 2018, DOI
[10.3384/ecp18148255](https://doi.org/10.3384/ecp18148255) —
<https://ep.liu.se/ecp/148/035/ecp18148035.pdf>. §7 "Architecture", verbatim:

> "**The web app is written in TypeScript and utilizes the React framework and the three.js 3D package.
> It communicates with the server using a REST API.**"
> "**HTML5 and WebGL provides an appropriate basis for web app development.**"

Server execution, verbatim:

> "A Modelica model is built up on the server while the model is being edited. When a simulation is
> requested, this Modelica model is compiled using **OCT** … into an **FMU**… The server uses the
> **Optimica Compiler Toolkit (OCT)** for maintaining the abstract syntax tree of a model being built up in
> the web app as well as performing the compilation. The simulation API is implemented in **Python** and
> uses the **PyFMI** API."

> **⚠️ Architectural lesson for a new editor:** Modelon's web client does **not** own the model AST — the
> *server* does, and the client edits against a REST API. This is the same shape as OMEdit's
> `OMCProxy::updateConnection(...)` delegation (§2.1), just over HTTP instead of in-process. Both reference
> implementations avoid the hard problem of a lossless client-side Modelica round-trip.

**(c) Modelon's own paper comparing Impact with an in-browser engine** — Modiator's authors, verbatim
(<https://www.ecp.ep.liu.se/index.php/modelica/article/view/1307>):

> "The commercial Modelica environment Modelon Impact (Elmqvist et al. 2018) also provides a browser GUI.
> **However, compilation and simulation of models are not performed in the browser but via a cloud service
> that has to be paid for.** The default behavior of Modiator is that models are compiled and simulated
> locally in the browser."

**(d) Diagram View and Icon Editor feature set** (Modelon docs, verbatim):
- <https://help.modelon.com/latest/articles/ao_diagram_view/>: "The Diagram View (also called canvas)
  displays the structure of the active class (model)… The user can drag and drop components to the canvas
  and connect them… In the Diagram View, the **zoom focus point is the last known position of the mouse
  pointer**." Plus copy/paste, resize, pan, zoom, Ctrl +/−, and "Stickies".
- <https://help.modelon.com/latest/articles/ao_icon_editor/>: "using graphical primitives like
  **rectangles, ellipses, texts, lines and polygons**"; advantages "Small memory footprint / Icon can be
  scaled up and down without any loss of the image quality (cf. vector graphics) / **Self-contained: All the
  information is stored in the model/class**". Bitmaps: "PNG, JPG, BMP (not recommended, due to large
  memory), or **SVG (displayed like PNG)**"; drawback "**The image is stored outside the model**".

  > The primitive vocabulary is **exactly Modelica §18.6.5's six primitives minus `Bitmap`** — independent
  > confirmation that the spec's primitive set is the right scope. And note the "self-contained" argument:
  > it is precisely the rationale for `imageSource` in §18.6.5.6 — which Modelon then declined to implement
  > (see (f)).

**(e) Compiler/stdlib/FMI** (<https://help.modelon.com/latest/reference/oct/>): OCT "is the calculation
engine (both compiler and solver) used by Modelon Impact", "a Modelica compiler compliant with the Modelica
language specification (MLS) **3.4** supporting both Modelica Standard Library (MSL) 3.2.3-build3 as well as
… **4.0.0**", with the exception that **MLS ch. 16 (Synchronous Language Elements) and ch. 17 (State
Machines) are not supported**. It "generates Functional Mock-up Units (FMUs), including Model Exchange and
Co-simulation as well as version 1.0 and 2.0 of the FMI standard"; solvers CVode and Radau; the Optimica
extension for dynamic optimization. ⚠️ FMI 3.0 support **not confirmed**.

**(f) ⚠️ The single most useful document found: Modelon's *Graphical user interface limitations***
(<https://help.modelon.com/latest/reference/limitations/>) is effectively **a list of which Modelica §18
features a mature commercial browser-based editor does NOT implement** — a free scoping document:

*Connectors and connections*
> "**Text primitives on connection lines are not shown and cannot be added.**"
*(the §18.6.4 connect-`Text` with `index`/`%first`/`%second` is unimplemented.)*

*Icon and diagram graphics*
> "The **`preserveAspectRatio` annotation is not considered** when resizing a component."
> "**Border patterns are not supported: `Raised`, `Sunken`, `Engraved`.**"
> "Support for **arrowheads and line patterns for `Line` primitives is partial**."
> "The **`textStyle`, `fontName` and `fontSize` attributes are not supported** for `Text` primitives."
> "The **`visible` annotation for graphical primitives is not supported in experiment mode**."
> "Modelon vendor-specific **`DialogExtensions`** annotations **`hide`, `hideInEditingState` and
> `hideInNonEditingState` are not supported in experiment mode**."
> "**Impact does not support bitmap graphics in Icon or Diagram annotations that are stored binary in
> Modelica code.** Bitmaps (PNG, JPG, BMP) must be available as a file in the Modelica `Resources` folder
> and can then be linked in the graphic annotations."

> **That last item is a live example of the `fileName` vs `imageSource` split (§1.4.6): Modelon does not
> implement the base64 `imageSource` variant at all.** The `DialogExtensions` reference is also concrete
> evidence of **vendor-specific annotation extensions in the wild**, exactly as sanctioned by §18.1 — and a
> reminder that a new editor must *preserve* them even when it does not understand them.

*Modelica / parameters*
> "**The graphical user interface (GUI) of Modelon Impact does not support all UI interpretations proposed
> in the Modelica specification**, such as regarding protected or `final` declared statements or certain
> line styles."
> "It is not possible to modify parameters for record arrays." / "`Modelica.Clocked` in MSL 4.0 is not
> supported." / "It is not possible to create a short-class declaration."
> "The **`displayUnit` attribute is not supported.** A global setting for converting units is provided
> instead."

> ⚠️ The spec **requires** `%par` numeric substitution to be formatted with `displayUnit` (§1.4.5). A tool
> that ignores `displayUnit` renders `%R`, `%C`, `%J` labels differently from the spec and from other tools.

**Cross-cutting lesson:** Modelon repeatedly answers these with "*the code editor can be used to work on
lots of the above GUI-related limitations*". A browser Modelica editor needs **both** a diagram view and a
first-class text view — the diagram view cannot be lossless for every construct.

**(g) Open-source client libraries (verified).** `modelon-community/impact-client-js` — TypeScript,
BSD-3-Clause, v4.1.0, deps `axios` + `fast-xml-parser` + `tough-cookie`, author "Modelon AB" — is a **REST
API client, NOT a rendering library**. Also `impact-client-python` and `impact-webapp-example` (JS, "App
Mode" custom web apps). **`modelon-community` contains no frontend/graphics/rendering library.**
⚠️ **UNVERIFIED: what the present-day Impact 2D diagram canvas renders with** (SVG / Canvas / WebGL /
React-Flow / Konva). No Modelon source names it. Treat "React + TypeScript + three.js" as the **documented
2018** architecture, not a confirmed present-day 2D-canvas implementation detail.

### 2.2.3 Modiator — **the strongest proof that Modelica can be *simulated* in the browser**

- **Status: LIVE PWA.** <https://modiator.netlify.app/> returns HTTP 200 and serves
  `manifest.webmanifest`. Companion app **Modicalc** ("Modelica Instant Calculator"):
  <https://modicalc.netlify.app/> → 200, also a PWA.
- **Authors:** **Hilding Elmqvist** (Mogram AB) and **Martin Otter** (DLR) — i.e. the original
  Modelica/Dymola author and a long-time MSL maintainer.
- **Paper:** "Modiator — A Web App for Modelica Simulation", **16th International Modelica & FMI
  Conference, Sept 2025**, DOI [10.3384/ecp218211](https://doi.org/10.3384/ecp218211) —
  <https://www.ecp.ep.liu.se/index.php/modelica/article/view/1307>.
- **Execution technology, verified by artifact:** `https://modiator.netlify.app/cvode.wasm` returns
  **HTTP 200, 146,200 bytes, `Content-Type: application/wasm`** — i.e. the SUNDIALS CVODE integrator
  really is shipped as WebAssembly. Paper, verbatim: "**CVODE has been translated from C to WebAssembly
  utilizing Emscripten and is called from Javascript when simulation starts.** When derivatives need to be
  calculated, a Javascript callback function is called from CVODE." And: "Modelica models are translated to
  **JavaScript functions which calculate the derivatives** given time, states and parameters."
- **Rendering technology, verbatim:**
  > "**The DOM/CSS-feature `style.transform` provides the fundamental rendering functionality to implement
  > infinite canvas in the browser.**"
  > "The model diagram rendering is inspired by the **2.5D look of Playmola** … i.e., that icons have a 3D
  > representation which are placed in a 2D diagram."
  So: **the infinite canvas is DOM/CSS-transform based — not SVG, Canvas or WebGL.** Model3D uses
  **three.js** (confirmed from the live `index.html`, which contains an importmap mapping `three` to
  `https://unpkg.com/three/build/three.module.js`); **plotting is Plotly**.
- **Runtime characteristics:** parsing/translation/simulation run in **web workers**; arrays/matrices are
  **not scalarized** but evaluated via runtime calls and **math.js**; the derivative function is built with
  `new Function()` (JIT); Monte Carlo is offloaded to Netlify Functions (AWS Lambda) — "10000 simulations
  have been performed on the cloud. The startup time for each simulation was less than a second."
  Bundle sizes are large: `modiator.js` ≈ 40.9 MB, `simulationAPI.js` ≈ 18.4 MB.
- **Public JS API:** `import { simulateModel } from 'https://modiator.netlify.app/simulationAPI.js';` →
  `{trajectories, parameters} = await simulateModel({modelText, modifier, stopTime})`.
- ⚠️ **UNVERIFIED / caveats:** the paper states "**A subset of Modelica is supported**" (with extensions:
  undeclared variables, optional semicolons, Greek identifiers, `der2`, `time(max=20)`). Also, grepping the
  40 MB minified bundle for `CodeMirror`/`Monaco`/`D3`/`dagre` produces substring matches that are
  **bundle artifacts, not documented facts** — only three.js (importmap) and Plotly/math.js (paper) are
  confirmed.

### 2.2.4 OpenModelica's browser/WASM story is fragmentary

- **`tshort/openmodelica-javascript`** — "Simulation in Web Browser". **Dead**: created 2013-09-21, **last
  push 2014-02-21**. README, verbatim: "The files in this repository include some files to help
  OpenModelica compile models to JavaScript using **Emscripten**. Thanks to Martin Sjölund (a core
  OpenModelica developer), OpenModelica has a backend that supports compilation with Emscripten." "**All
  the calculations are done on the client.**" "models in Firefox run within about 1.5X of native, and in
  the most recent Chrome, they run within 2X of native. The key to the speed is that Emscripten compiles to
  the **asm.js** format" — i.e. **asm.js, predating WebAssembly**. The official OpenModelica User's Guide
  page "Simulation in Web Browser" (`emscripten.html`, v1.22) still points at this dead repo.
- **OpenModelica `wasm-jit` — real and active.** OpenModelica's compiler is being **rewritten in Rust**
  under `OMCompiler/Compiler/OpenModelica.rs/`, with a **`wasm-jit` code-generation target**. Evidence:
  commit [`e7c7e67`](https://github.com/OpenModelica/OpenModelica/commit/e7c7e67c06387b9794c5b37c12d1289d3b926e2a),
  author **Martin Sjölund** (Linköping University; **Modelica Association Vice-Chairperson**), subject
  "wasm-jit: honour -lv=-LOG_STDOUT in ModelicaMessage (#16312)". Body, verbatim: "…which the **wasm-jit
  target does not produce — it JIT-compiles the model and keeps it in the omc process**." Crates
  `openmodelica_wasi`, `openmodelica_sim`, `openmodelica_modelica_utilities` are present in the tree, and
  the Jenkins CI has a test group **`openmodelica_codegen_wasm_jit` with 26 tests**.
  ⚠️ **UNVERIFIED: there is no announcement, no `omc-wasm` repo, no documented public API, and no
  confirmation that this target runs OMC in a browser tab** — WASI can equally mean server/edge.
- **No official "OpenModelica on the web" interactive session** or OMC-as-a-service was found. OMNotebook
  is a desktop app. ⚠️ Negative finding.

### 2.2.5 ⭐ `tree-sitter-modelica` — a ready-made browser-side Modelica parser (the best immediate win)

This is the most directly actionable verified result for a browser editor.

- **`OpenModelica/tree-sitter-modelica`** — "A tree-sitter parser for Modelica" / "An open-source Modelica
  (**Modelica Language Specification v3.5**) grammar and highlighting-query for tree-sitter." Dependencies:
  Node.js + **Emscripten (for building the `.wasm` file)**. The README **explicitly documents browser
  usage**:
  > "Use Web Tree-sitter `tree-sitter-modelica.wasm` in your application" — with a TypeScript snippet:
  > `import * as Parser from 'web-tree-sitter'; await Parser.init(); const Modelica = await
  > Parser.Language.load('tree-sitter-modelica.wasm');`
  (<https://raw.githubusercontent.com/OpenModelica/tree-sitter-modelica/master/README.md>)
- Corroborated from OpenModelica's own OMEdit User Guide, verbatim: the language server "is installed in
  `share/omedit/ls/modelica` as three files: the server itself and the **two `.wasm` files it parses
  Modelica with**… Keep **`tree-sitter-modelica.wasm`** and **`web-tree-sitter.wasm`** in the same
  directory as the binary; without them the server starts but reports nothing."
- **`OpenModelica/modelica-language-server`** — "A very early version of a Modelica Language Server based
  on OpenModelica/tree-sitter-modelica"; provides Outline, Goto declaration, Hover; TypeScript; **no OMC
  dependency**. Consumed by VS Code (via `modelica.libraries` in `.vscode/settings.json`) and by OMEdit.

> **What this gives you and what it does not.** ✅ Real Modelica parsing, syntax highlighting, outline and
> structural navigation **in the browser, with no server**; tree-sitter's error-recovering parse suits an
> editor holding partially-invalid source. ⚠️ It is a **concrete syntax tree, not a resolved Modelica
> AST** — it does **not** give class lookup, `extends` flattening, modifier application, `Dialog`/`choices`
> extraction, `if`-condition evaluation for conditional connectors, or `%par` substitution, all of which a
> *correct* diagram editor needs (§1.5, §1.10, §1.13.1). And the language server is self-described as "**a
> very early version**".

### 2.2.6 Other browser-native Modelica projects (verified)

| Project | What it is | Rendering / execution tech | Confidence |
|---|---|---|---|
| **ModelScript** (`modelscript/modelscript`) | "a completely web-native, polyglot incremental compiler… natively supporting Modelica, SysML v2, and STEP"; AGPL-3.0-or-later. Packages `@modelscript/core` (parse/analyze/flatten/simulate), `/simulator` (**Pantelides index reduction, BLT ordering**), `/cosim` (SSP), `/fmi`, `/lsp`, `/modelica` (**tree-sitter native + WASM**), `/optimizer`, `/mcp`. Docker `ghcr.io/modelscript/{api,morsel,web,ide}`. | **`@svgdotjs/svg.js`** (verified in the npm deps of `@modelscript/core@0.0.18`) ⇒ **SVG rendering**. | ✅ rendering dep verified; ⚠️ activity/archived status and Modelica coverage **unverified** |
| **Bodylight.js** | Physiology-modelling toolchain; "**No server, no plugin, no addons needed.**" | Two-step pipeline: **(1) Modelica → FMU, (2) FMU → WebAssembly via Emscripten**; FMI **2.0 co-simulation with source**; UI = **Web Components**; animation via Adobe Animate/Create.js. ⚠️ "**OpenModelica only includes the Euler solver in the FMU**"; Dymola requires a source-code-generation licence. Compiler repo `creative-connections/Bodylight.js-FMU-Compiler` (beta). Paper: Kulhánek et al. 2023, DOI [10.3384/ecp204443](https://doi.org/10.3384/ecp204443). | ✅ pipeline verified |
| **rumoca** (CogniPilot) | Rust Modelica compiler, Apache-2.0, "in active development"; on the MA tools list. Pipeline parse→resolve→typecheck→instantiate→flatten→DAE→structural(BLT)→simulate→codegen. | "browser and tooling workflows **via WASM**"; "Multi-file session API for CLI, LSP, WASM, and tests"; "**focused Monaco editors that call Rumoca on book-local files**"; `nix develop .#wasm` (Node, Binaryen, wasm-pack); playground <https://cognipilot.github.io/rumoca/>. Paper: Condie et al., Modelica Conferences 2025, pp. 1009–1016. | ✅ README; ⚠️ **no Modelica Icon/Diagram graphical canvas found in rumoca** |
| **ODE+** (Orthogonal Supersystems) | On the MA tools list. "AI-first systems engineering platform in the browser… fully supports the Modelica language and MSL… FMU/SSP editing, hardware-in-the-loop simulation, 3D visualization." Marketing: "Model & simulate physical systems **in the browser**. A diagram canvas with validated ports, **a real in-browser solver with its own run board**." Endorsers named on the page include DLR, TUM, VW and **Martin Otter**. | ⚠️ **No rendering technology disclosed.** | ✅ claims quoted; ❌ tech **UNVERIFIED**; not independently tested |
| **YSSIM** (SIMTEK, 南京远思) | On the MA tools list: "a web-based platform for system-level modeling, simulation data management and virtual experimentation… **browser/server microservice architecture**… Modeling is done in the browser against the Modelica language standard… Models can be exported as FMUs." Vendor page (Chinese): "基于WEB技术自主开发…云端建模仿真", "Web图形化拖拽连线", FMI 2.0. | ⚠️ **No rendering technology disclosed.** | ✅ claims quoted; ❌ tech **UNVERIFIED**. Note **Rui Gao (SimTek) is the Modelica Association Secretary** |
| **`modelica/fmi-ls-wasm`** | ⭐ **Modelica-Association GitHub-org repo**: "WebAssembly WIT mapping of FMI 3.0 API". README verbatim: "contains a current prototype draft… **This is currently not normative, nor is this document to be considered officially endorsed by the Modelica Association** or other involved organisations prior to official adoption." Spec: <https://modelica.github.io/fmi-ls-wasm/main/>; Rust/C/WAT example FMUs + host runners. | ✅ verified, incl. the non-normative disclaimer |
| `modelica-tools/webmodelica` | "A web-based Modelica-Toolbox", 1,032 commits — **a fork**; upstream appears to be `THM-MoTE/webmodelica`. | ⚠️ **UNVERIFIED: README 404 on every branch tried; contents, stack and liveness unknown.** |
| `modelica-tools/modelica-json` | "Modelica to JSON parser … parses Modelica to JSON, and from JSON to different output formats." Modified BSD; from LBNL (`lbl-srg`). | Potentially useful as an annotation-extraction path |
| `modelica-tools/marco` | "MARCO - Modelica Advanced Research COmpiler … based on the LLVM / MLIR compiler technology." | — |
| `modelica-tools/baby-modelica` | "a simple frontend (parser+flattener) for the Modelica language specification 3.4", RIKEN R-CCS, "Current status is a pre-zero version." | — |
| `modelica-tools/moparse` | Rust Modelica parser, MPL-2.0 — "**This crate is no longer maintained.** Parser was included directly into mofmt." | — |

> ❌ **Do not cite `fmi4wasm`.** Probed `CATIA-Systems`, `DassaultSystemes`, `3ds-fmi`, `markert`, `pmai`,
> and `fmi4wasm` orgs — all 404. Its existence is **unconfirmed**.

### 2.2.7 Modelica Association tool list — what is actually web-accessible

Source: <https://modelica.org/tools/> (fetched directly).

**Free simulation environments:** OpenModelica (Open Source Modelica Consortium); **rumoca** (CogniPilot
Foundation).
**Commercial:** Altair Twin Activate (Modelica powered by Maplesoft engine + MSL); Simplorer (Ansys);
Dymola (Dassault Systèmes); SimulationX (Keysight); MapleSim (Maplesoft); **Impact (Modelon)**;
**ODE (Orthogonal Supersystems)**; PortfolioEnergy; Simcenter Amesim (Siemens); **YSSIM (SIMTEK)**; MWorks
(Suzhou Tongyuan); SystemModeler (Wolfram Research).
**Free editors/extensions:** Atom (`language-modelica`); Emacs `modelica-mode`; Sublime Text package;
UltraEdit syntax highlighting; **VS Code** (`SimplyDanny.modelica`).
**Developer tools:** Modelica Compliance Suite; CSV Result Compare; **MapleSim Standalone Modelica Parser
(+ an online version)**; trim-trailing-whitespaces; PMD; **MLQT** (desktop app + libs for managing Modelica
libraries in Git/SVN, **plus an MCP server for creating/editing Modelica models**).
**Other free tools:** awesim; BuildingsPy; DyMat; Highlight; listings-modelica; ModelicaRes;
modelica-builder; modelica-fmt; OpenModelica Microgrid Gym; PlotXY; PySimulator; Simulink-Block.

**Web / cloud / browser-accessible (classification):** **Impact** ("browser interface"), **ODE** ("in the
browser… FMU/SSP editing"), **YSSIM** ("web-based… browser/server microservice architecture"), **rumoca**
("WebAssembly bindings, browser-native playground"), **Dymola** (desktop tool + "cloud simulation on the
3DEXPERIENCE platform"), **SimulationX** ("available for test online"). Desktop-only: OpenModelica, Twin
Activate, Simplorer, MapleSim, PortfolioEnergy, Simcenter Amesim, MWorks, SystemModeler.

### 2.2.8 There is **no** Modelica Association graphics / diagram-interchange standardization effort

Verified negatives:

- **No MA Project for graphics or diagram interchange.** <https://modelica.org/association/> lists exactly:
  **Modelica Language, Modelica Libraries, FMI, SSP, DCP, eFMI**. (Language leaders: Hans Olsson / 3DS and
  Henrik Tidefelt / Wolfram Mathcore — the same author as the `Transformation` commit in §1.5.1a.)
- **`https://modelica.org/projects/` is a 404.** The real page,
  <https://modelica.org/community/projects/>, lists only **externally funded research** projects
  (OpenSCALING, PHyMoS, MOSIM, ModeliScale, UPSIM, EMPHYSIS, ACOSAR, MODRIO, OPENPROD, MODELISAR,
  EUROSYSLIB) — **none about graphics**.
- **The `modelica` GitHub org contains no graphics/diagram/SVG/rendering repo.** Full enumeration:
  DCPLib, efmi-standard.org, fmi-beginners-tutorial-2025/2026, fmi-ls-bus(+examples), fmi-ls-dae, fmi-ls-ref,
  fmi-ls-struct, **fmi-ls-wasm**, fmi-standard(.org), fmusim, MA-Bylaws, ma-hs-csv, ma-hs-experiments,
  ma-hugo-theme, MAP-LIB_ProjectRules, MAP-LIB_ReferenceResults, Modelica_LinearSystems2,
  ModelicaSpecification, ModelicaStandardLibrary, Reference-FMUs, specification.modelica.org,
  ssp-ls-traceability(+examples), ssp-standard(.org), VehicleInterfaces, www.modelica.org.
  ➡️ **The layered-standards track covers bus, DAE, ref, struct, wasm + SSP traceability — no graphics.**
- ⚠️ **UNVERIFIED:** whether some *informal* MA interest group exists outside the public project list. No
  "MDI" / "Modelica Diagram Interchange" standard was found anywhere.

> **Conclusion: the interchange format for Modelica diagrams *is* the annotated Modelica source text.
> There is no separate standardized diagram file format, and no MA effort to create one.**

### 2.2.9 Prior art for rendering Modelica diagrams more richly — Playmola "3D Schematics"

**"3D Schematics of Modelica Models and Gamification"** — H. Elmqvist, A. D. Baldwin, S. Dahlberg, 11th
International Modelica Conference, Versailles, Sept 2015 —
<https://2015.international.conference.modelica.org/proceedings/html/submissions/ecp15118527_ElmqvistBaldwinDahlberg.pdf>.

- Introduced "3D Schematics" — "a generalization of object diagrams… to utilize 3D representations of the
  icons/shapes and unification with assembly diagrams and exploded views" — prototyped as **Playmola**
  (HTML5 + three.js, VR/Google Cardboard).
- **Directly relevant to a diagram renderer:** "The 3D representation of the revolute joint has been
  **automatically derived from the Modelica annotation of the icon** which contains:
  `Rectangle(extent={{-100,-60},{-30,60}}, lineColor={64,64,64}, **fillPattern=FillPattern.HorizontalCylinder**,
  fillColor={255,255,255}, radius=10)`" — real prior art for **deriving 3D from `annotation(Icon(...))`**.
- Historical note: "As a consequence, a flat 2D graphics representation was introduced in Modelica" — as a
  1990s rendering-speed compromise. Modiator explicitly cites Playmola for its 2.5D diagram look (§2.2.3).

Related earlier prior art (**[secondary]** — cited in the WAMS paper, not fetched): **WebMWorks**, L. Qi
et al., 9th International Modelica Conference, Munich, 2012 — "a web-based modeling and simulation
environment for Modelica."

## 2.3 Desktop editors — Dymola, Simulink, System Modeler, MapleSim, 20-sim, Mathcad

**Source-quality note.** Most sources were fetched directly and quoted verbatim. **`mathworks.com` returns
HTTP 403 to direct requests from this host**, so MathWorks pages were retrieved via a text-extraction proxy
that returns the verbatim content of the real URL; the citation URLs are the genuine MathWorks URLs and are
flagged per item. PDFs (Dymola 5.3a manual, 20-sim 5.1 Reference Manual, Wolfram System Modeler User Guide)
were downloaded and text-extracted locally.

### Source-quality summary

| Tool | Rendering tech | Routing behaviour | Acausality |
|---|---|---|---|
| **OMEdit** | **VERIFIED** (source + CMake + docs): QGraphicsView/QGraphicsScene + QPainter; OSG/Quick3D for 3-D only; WebEngine/QuickWidget for docs | **VERIFIED**: local manhattanize only, **no autorouter** | VERIFIED (Modelica) |
| **Dymola** | **UNVERIFIED** | **VERIFIED** (vendor manual): manual drawing + *Edit ▸ Manhattanize* + optional automatic manhattanize | VERIFIED (manual has an "Acausal modeling" chapter) |
| **Simulink** | **PARTIAL**: Java/JVM GUI (support-forum level); next-gen = C++ + TS/JS, "HTML5 Canvas a plus" (job-board mirror). Shipping canvas API **UNVERIFIED** | **VERIFIED** (MathWorks blog): *smart signal routing* — optimal path, minimum disturbance | **VERIFIED** (MathWorks patent + Simscape doc): directed signal flow vs non-directional physical connections |
| **Wolfram System Modeler** | **PARTIAL**: separate native app (VERIFIED); Qt platform plugin ships (unofficial AUR evidence) | **VERIFIED** docs: right-angle lines by default, optional curved; no autorouter documented | VERIFIED (Modelica) |
| **MapleSim** | **UNVERIFIED** | **VERIFIED** docs: L/Z orthogonal layouts + "reroute to simplest form" | VERIFIED (Modelica "white-box" platform) |
| **20-sim** | **UNVERIFIED** (Windows-only; no Java/Qt in requirements) | **VERIFIED** docs: manual straight lines, intermediate points, optional smooth line | **VERIFIED** docs: auto-detects signal/bond/iconic connection; causality computed by "Analyze Causality" |
| **PTC Mathcad** | N/A (**not a diagram tool** — VERIFIED from PTC's own page) | N/A | N/A |

### 2.3.1 OMEdit — addenda to §2.1 (independently verified from source)

Additional primary evidence confirming §2.1's conclusion, plus two corrections:

**What is genuinely OpenGL/QML in OMEdit — and what is not.** `OMEdit/OMEditLIB/CMakeLists.txt` links
`Qt::Widgets`, `Qt::PrintSupport`, `Qt::OpenGL`, `Qt::WebEngineWidgets`, and either
`Qt::Quick Qt::Quick3D Qt::Qml Qt::QuickWidgets` (when `OM_OMEDIT_ANIMATION_QUICK3D`) or
`${OPENSCENEGRAPH_LIBRARIES}`. `OMEdit/OMEditLIB/OMEditLIB.pro` contains
`CONFIG(osg) { SOURCES += Animation/OpenGLWidget.cpp Animation/ViewerWidget.cpp ... }` and **zero**
occurrences of `qml`/`webengine`. `MainWindow.cpp` explains the split, verbatim:

> "Not on macOS: Qt cannot mix a QOpenGLWidget and a QQuickWidget in one window unless they agree on the
> graphics API… Forcing OpenGL leaves both the Quick3D animation view and **the documentation view (a
> QQuickWidget underneath)** with no QRhi, rendering nothing."

> ➡️ **Diagram/icon canvas = `QGraphicsView` + `QPainter`. Documentation browser = Qt Quick/QML widget.
> 3-D animation window = OpenSceneGraph (`Animation/OpenGLWidget.cpp`) or Qt Quick3D.** No GPU 3-D is used
> for the diagram — which is relevant if you are choosing a browser renderer.

**Naming correction.** `OmsGraphicsView` / `OMSGraphicsScene` **do not exist** in current master
(`OMS/OMSGraphicsScene.h` → HTTP 404; `OMS/OMSModel.h` and `OMS/OMSProxy.h` → 200). The old pre-~2015 path
was `OMEdit/OMEditGUI`; the current path is `OMEdit/OMEditLIB`. **SSP/OMSimulator editing reuses the same
`GraphicsView`/`LineAnnotation` machinery** (`ModelWidget::drawOMSModelDiagramElements`,
`LineAnnotation::updateOMSConnection`).

**No autorouter — established from source, not docs.** `LineAnnotation::handleComponentMoved(bool)` only
**re-anchors** endpoints: it maps the connector centre to scene coordinates, rounds to grid, and hard-clips
the line against the component bounding rect via `Utilities::liangBarskyClipper(...)`. When both endpoints
move together it simply translates every point by the same offset. `manhattanizeShape` inserts a single
L-bend between the first and last non-straight segment; `isLineStraight` requires the angle to be exactly
0/90/180/270/360. **No A\*, no obstacle avoidance, no path search was found.**
⚠️ This is an argument from absence over the files inspected (`Annotations/`, `Modeling/`, build scripts),
**strong but not exhaustive** over OMEdit's ~700 source files. Provenance:
[Trac #2506 "Keep connecting lines manhattanized"](https://trac.openmodelica.org/OpenModelica/ticket/2506)
(fixed, milestone 1.9.2, 2014), where maintainer Adeel Asghar writes: *"I want to keep lines manhattanized
when things move around and add points automatically if required."* … *"In r23357 I have added some support
for keeping the lines manhattanized which works pretty fine with Dymola … & SystemModeler models."* …
*"If you add a point which creates an oblique line then it will be automatically removed by
`manhattanizeShape` method."*

> ⚠️ **Documentation gap:** the official OMEdit chapter of the OpenModelica User's Guide documents connect
> mode and connection editing but **never mentions routing, manhattanize or orthogonal lines** (grep for
> `rout|manhattan|orthogonal` → no substantive hits). The behaviour had to be established from source + Trac.

**Move / rotate / mirror** (source-verified): `GraphicsView` declares `mpRotateClockwiseAction`,
`mpRotateAntiClockwiseAction`, `mpFlipHorizontalAction`, `mpFlipVerticalAction` with slots
`rotateClockwise()`, `rotateAntiClockwise()`, `flipHorizontal()`, `flipVertical()`; `ShapeAnnotation` has
`moveUp/moveDown/moveLeft/moveRight`, `moveShift*` (grid step × 5) and `moveCtrl*` (1 px) slots, and
`applyTransformation()` composes a `QTransform` from `mOrigin`, `mRotation`, `mExtent`.
⚠️ **UNVERIFIED in official prose** — the user guide only documents cursor manipulation indirectly.

**Two second-order details worth copying from OMEdit** (both seen in source):
1. **Line colour defaults from the starting connector's first icon shape** — and OMEdit's own comment notes
   *"Dymola is doing it the way explained above. The Modelica specification doesn't say anything about
   it"*. Dymola's manual corroborates: *"The connection gets the color of the outline of the first
   rectangle, polygon or ellipse in the icon layer of the starting connector."*
2. **Instance-based rendering** — render from the *instantiated* model so conditional/parameterized
   connectors, inherited shapes and `IconMap`/`extends` extents resolve correctly. The OMEdit General
   Options text states: *"The instance-based graphical editing enables features like parameter-dependent
   conditional connectors… It also provides much faster rendering than the previously implemented graphical
   editing framework."* This is the practical answer to §1.5/§1.7.4.

Also present in `LineAnnotation`: `setStartElementName`/`setEndElementName`, `getDelay`/`getZf`/`getZfr`/
`getAlpha` (TLM/OMSimulator connection attributes), and `ExpandableConnectorTreeModel` /
`CreateConnectionDialog` for **expandable-connector member selection** — i.e. a real UI for choosing *which*
member of an `expandable connector` a wire attaches to (§1.7.3).

**Vendor/status:** Open Source Modelica Consortium (OSMC); AGPL v3 / OSMC-PL dual licence;
`OMEdit/README.md`: *"A Modelica connection editor for OpenModelica."* Actively developed (master includes
`OMEditLIB/MCP`, `Traceability`, `LSP`).

### 2.3.2 Dymola (Dassault Systèmes)

- **Rendering technology: ⚠️ UNVERIFIED — no authoritative source found.** No Dassault/Dynasim statement
  naming Dymola's GUI toolkit or renderer could be located. Specifically checked and found nothing: the
  complete **Dymola 5.3a User's Manual** (full-text search for motif/x11/Qt/Java/Tcl/Tk/OpenGL/"user
  interface is"/"implemented in"), the Dymola 2025x release highlights, and a Dymola 2023x release-notes PDF
  URL (that URL on cenit.com serves HTML, not a PDF).
- **What IS verified — from the vendor manual** (Dymola 5.3a User's Manual, © 1992–2004 Dynasim AB,
  <https://people.inf.ethz.ch/cellier/Lect/MMPS/Refs/Dymola5Manual.pdf>), verbatim:
  > "The graphical model editor is used for creating and editing models in Dymola. Structural properties,
  > such as, components, connectors and connections are edited graphically, while equations and
  > declarations are edited with a built-in text editor."
  > "Connections are defined interactively in Dymola in a manner similar to drawing lines. • Click on a
  > connector and draw a line, possibly with multiple line segments… • Click on another connector to finish
  > the connect operation."
  > "The line segments of the connection snap to the grid of the class by default, but are then adjusted so
  > the connection end points reach the corresponding connectors. This may cause skewed lines if the grid is
  > coarse, but it can usually be adjusted with **Edit/Manhattanize**. The manhattanize operation inserts
  > points until there are at least four points to work with, so the line can be drawn at right angles."
  > "**If automatic manhattanize is enabled, connections are manhattanized immediately when created, moved
  > or reshaped. If automatic manhattanize is on, moving a component automatically manhattanizes all
  > connections to the component.**"
  > "A connection is a graphical representation of a `connect` statement between two connectors."
  > "When drawing a connection, the default color is taken from the starting connector. The connection gets
  > the color of the outline of the first rectangle, polygon or ellipse in the icon layer of the starting
  > connector."
- **Acausality:** the same manual contains a dedicated chapter **"Acausal modeling → Background /
  Differential-algebraic equations"** alongside "Connectors and connections" under "Modelica basics".
- **Vendor/status:** Dassault Systèmes (Dymola originated at Dynasim AB, Lund, Sweden). Dymola 2025x
  announced Dec 2024 ([Claytex summary](https://www.claytex.com/news-and-events/dymola-2025x-available/) —
  distributor, **secondary**). Product page: <https://www.3ds.com/products/catia/dymola>.

### 2.3.3 Simulink (MathWorks) — ⚠️ CAUSAL, and the best-documented ROUTER

- **Rendering technology: PARTIAL, and it is changing.**
  - **Legacy/current generation = JVM-dependent (Java) GUI.** MathWorks Support Team answer,
    verbatim ([MATLAB Answers 102417](https://www.mathworks.com/matlabcentral/answers/102417-how-does-nojvm-mode-affect-matlab-simulink)
    — official MathWorks staff, but a **support-forum post, not product documentation**; flag as
    *semi-primary*):
    > "Certain MATLAB features, such as the MATLAB Editor, GUIDE and the Array Editor, are written in Java
    > and therefore require the Java Virtual Machine (JVM) in order to run."
    > "**There is no comprehensive list of the things that will get affected in Simulink.** However, some of
    > the tools that will not work properly in `nojvm` mode are Lookup Table Editor, Data Class Designer,
    > Bus Editor, Signal & Scope Manager, Parameter Estimator, Simulink Report Generator, Floating Scope
    > (Signal Selector GUI), Model Reference Signal Logging, **Mask Editor, Simulink Debugger**, Finder,
    > Some dialogs like Model and block properties, Stateflow Truth Table editor etc."
  - **Next generation = C++ + TypeScript/JavaScript, canvas-oriented.** MathWorks job requisition
    **35945-MCAR, "Principal Software Engineer – Simulink Stateflow GPL Editors"** (Natick, MA; ~Jan 2026,
    expired), read from a verbatim job-board mirror:
    > "You will work as part of a small team crafting the **next generation of our Simulink and Stateflow
    > graphical programming language editors**."
    > "Qualifications — **Proficiency with C++ and TypeScript or JavaScript** … Professional experience with
    > UI programming … Interactive graphics experience a plus … **Experience with HTML5 Canvas a plus**"
    ⚠️ The original MathWorks careers URL returns 403 to direct *and* proxied requests, so the mirror is the
    only accessible copy — **SECONDARY, unverified against mathworks.com**.
  - ⚠️ **UNVERIFIED: no MathWorks statement names the drawing API of the shipping editor canvas** (no
    Swing/Java2D/OpenGL/HTML-Canvas confirmation for the current release). A 2006-era MathWorks job ad for
    "Principal Java Software Engineer – Java\Swing" exists only as a forum mirror and describes **MATLAB's**
    IDE, not Simulink's editor — **do not use it as Simulink evidence**.
  - Product definition (primary, via proxy): "Simulink® is a block diagram environment for multidomain
    simulation and Model-Based Design… **Simulink provides a graphical editor**, customizable block
    libraries, and solvers" (<https://www.mathworks.com/help/simulink/ug/what-is-simulink.html>).

- **⚠️ Simulink HAS a real obstacle-avoiding autorouter — the only one found in this survey.** MathWorks blog
  "Guy on Simulink", 2012-10-11, *Smart Signal Routing*
  (<https://blogs.mathworks.com/seth/2012/10/11/smart-signal-routing/>), verbatim:
  > "The new Simulink Editor in R2012b does a much better job of drawing signal lines with one of my favorite
  > new features, **smart signal routing**. … when you draw a signal line, Simulink will **automatically find
  > the 'optimal path' so that the new signal line is as short as possible, has minimal 90 degree turns, and
  > doesn't overlap other blocks and text**."
  > "Part of the smartness of the smart signal routing algorithm is to know when to leave a signal alone.
  > It's what we call **'minimum disturbance.'**"
  This is genuine obstacle-avoiding orthogonal routing — **a capability OMEdit does not have** (§2.3.1).

- **⚠️ CAUSAL vs ACAUSAL — MathWorks itself documents the distinction.** MathWorks' own patent
  **US7873500B1, "Two-way connection in a graphical model"** (assignee MathWorks Inc.; inventors Brewton,
  Grace, Kumar, Sampson, Wendlandt), <https://patents.google.com/patent/US7873500B1/en>, verbatim:
  > "Simulink enables a user to build a **signal-based** model in which blocks in the model are connected
  > through signals that pass between connected blocks."
  > "**the signals may be represented by directed lines, such as arrows.**"
  > "the connection lines in the schematics of the schematic-based physical modeling tools can represent
  > **non-directional physical connections**, rather than the signal flow connections described above for
  > the signal-based block diagram representations."
  > "The two-way connection line provides a **two-way signal interface** between two-way connection ports."

  And the Simscape doc (via proxy): "With Simscape you build physical component models **based on physical
  connections** that directly integrate with block diagrams and other modeling paradigms."
  (<https://www.mathworks.com/help/simscape/ug/what-is-simscape.html>)

  > **Interpretation for the editor:** in Simulink the arrowhead **is semantics** (data flows output→input);
  > in Modelica `connect(a,b)` is an equation and the line's `points` are **pure presentation** (§18.6.4).
  > Simulink's autorouter is therefore unconstrained by conservation semantics, whereas a Modelica editor
  > must never let routing or mirroring change meaning — and must keep `arrow` purely decorative (the
  > Modelica `Arrow` enum **defaults to `Arrow.None`**).

- **Vendor/status:** The MathWorks, Inc. (Natick, MA). Simulink is a current flagship product; the
  acausal/physical-modelling sibling is **Simscape** (+ Simscape Multibody/Electrical/Fluids). MathWorks is
  actively rebuilding the Simulink/Stateflow editors (job req above).

### 2.3.4 Wolfram System Modeler — Model Center

- **Rendering technology: PARTIAL.** Model Center is unambiguously a **separate native application**, not a
  Wolfram Language notebook:
  - WSM User Guide (<https://reference.wolfram.com/legacy/system-modeler/v3/user-guide/system-modeler-user-guide.pdf>):
    "SystemModeler consists of a modeling environment, **Model Center**; a simulation environment,
    Simulation Center; and the **Wolfram SystemModeler Link package for Mathematica** (WSMLink)." and
    "Click the Mathematica button in either the Model Center or the Simulation Center toolbar" — i.e.
    distinct processes that link.
  - Wolfram Language reference: "**`WSMModelCenter[]` starts the System Modeler Model Center.** … If the
    Model Center is not running, it will be started. If it is running, it will be brought to the front."
    (<https://reference.wolfram.com/language/WSMLink/ref/WSMModelCenter.html>)
  - **Qt evidence — UNOFFICIAL, flag.** Arch Linux AUR page for System Modeler, maintainer comment
    2024-07-19 (<https://aur.archlinux.org/packages/systemmodeler>): "System Modeler seems to still need to
    use X Server or related components, which may be related to the **built-in Qt**. If used under Wayland,
    the following errors/warnings may occur: `qt.qpa.plugin: Could not load the Qt platform plugin "xcb" …`".
    This is direct runtime evidence that a Qt platform plugin ships inside System Modeler, but it is a
    **user/maintainer report, not a Wolfram statement**.
  - ⚠️ **UNVERIFIED:** no Wolfram statement names the toolkit or the 2-D canvas renderer, nor whether Model
    Center is Qt Widgets vs. a custom canvas. The commonly-repeated "System Modeler descends from
    MathModelica (Linköping University spin-off)" claim was **not** verified from a primary Wolfram source.
- **Connections / routing (VERIFIED, Wolfram docs):**
  > "To connect two components, select the Connection Line Tool and place the mouse cursor… release the
  > mouse button to complete the connection. **The connection line will be drawn as a right-angle connection
  > line.**"
  > "A connection line can be turned into a **curved connection line** by right-clicking on it and choosing
  > Curved Connection Line"
  Documented features also include "Changing the Default Color of Connection Lines" ("Connection lines, when
  created, are given a color matching the border color of the source connector"), `Placement` view
  properties incl. rotation, "Toggling Annotation Visibility", "Graphical Views" (icon + diagram), and
  "Resetting the screen resolution (DPI) … to make the size of graphic objects on screen match their actual
  specified size". ⚠️ **Whether Model Center has an obstacle-avoiding autorouter is UNVERIFIED** — the docs
  describe right-angle defaults and manual/curved overrides, not optimal-path search.
- **Vendor/status:** Wolfram Research. Current version **System Modeler 15.0**; Windows 11/10, macOS
  (x86-64 + Apple Silicon), Linux (Ubuntu 22.04/24.04/26.04, AlmaLinux 8/9/10, Debian 12–13, openSUSE Leap
  16.0, Fedora 43/44); requires a C++ compiler (MSVC / Xcode / GCC)
  (<https://www.wolfram.com/system-modeler/system-requirements/>).

### 2.3.5 MapleSim (Maplesoft)

- **Rendering technology: ⚠️ UNVERIFIED — no authoritative source found.** No Maplesoft statement naming
  MapleSim's GUI toolkit or canvas renderer (searched product site, "About MapleSim" help, Model Workspace
  help, system-requirements pages, ModelicaEngine page). The widely-assumed "MapleSim GUI is Java / built on
  the Maple (Java) front end" claim is **also unverified** — a French forum thread about a "java" startup
  problem in MapleSim 6.2 exists but is a forum post and was not relied upon.
- **What IS verified (Maplesoft official help, primary):**
  - "**Model Workspace** — The area in which you build and edit a model in a **block diagram view**."
    (<https://cn.maplesoft.com/support/help/MapleSim/view.aspx?path=tasks/building/maplesimWindow>)
  - "**Annotations Toolbar** — Contains tools for adding annotations and laying out objects."
  - Connection layout types
    (<https://maplesoft.com/support/help/maple/view.aspx?path=tasks%2fbuilding%2fselectingLineLayout>):
    "By default, as you connect two components that are positioned diagonally from each other in the Model
    Workspace, MapleSim **automatically selects and then allows you to draw either an L-shaped or Z-shaped
    connection line** based on the positions of the component ports." Options: "Default Connections" (auto),
    "L-Shaped Connections: … contain **two perpendicular segments**", "Z-Shaped Connections: … contain
    **three segments**. A perpendicular line segment is placed halfway between the components."
    Ctrl/Command toggles L↔Z while drawing.
  - Auto-reroute
    (<https://www.maplesoft.com/support/help/maplesim/view.aspx?path=tasks/building/reroutingConnectionLines>):
    "**MapleSim can automatically reroute all diagram connections to their simplest form** according to the
    connection layout type setting." (Edit ▸ Reroute Connections / **Ctrl+D**.) Note the wording:
    *simplest form* (L/Z orthogonality), **not** stated as obstacle-avoiding optimal-path routing.
  - Modelica basis: "**MapleSim is a 'white-box' Modelica® platform**, giving you complete flexibility and
    openness for complex multidomain models." (<https://cn.maplesoft.com/support/help/addons/view.aspx?path=about%2fMapleSim>);
    dedicated <https://www.maplesoft.com/products/maplesim/ModelicaEngine/> page; the Model Workspace toolbar
    includes tools for "viewing the corresponding Modelica code".
- **Vendor/status:** Maplesoft, Waterloo, Ontario, Canada — "Maplesoft™, a subsidiary of **Cybernet Systems
  Co. Ltd.** in Japan" (per 2026 page footers). Products current.

### 2.3.6 20-sim (Controllab) — ⭐ the closest *acausal* editor precedent after Modelica tools

- **Rendering technology: ⚠️ UNVERIFIED — no authoritative source found.** The 20-sim 5.1 Reference Manual
  (© 2026, Controllab Products B.V.) contains **no** statement about GUI toolkit or renderer (grep for
  java/qt/motif/.NET/"gui toolkit"/rendering returned only unrelated hits). The
  [Requirements](https://20sim.com/webhelp/requirements.php) page lists only "Windows 8, 8.1, 10 and 11
  (32-bit or 64-bit)… an Intel or AMD CPU with **AVX2** support… ≥ 3 GB memory… 690 MB free disk space" —
  **Windows-only; no Java and no Qt requirement listed.** Do not guess a toolkit.
- **What IS verified (vendor manual/docs):**
  - Editor structure ([20-sim Reference Manual](https://www.20sim.com/downloads/files/20simReference.pdf)
    §7.1.1): "20-sim consists of two main windows and many tools. The first window is the **Editor** and the
    second is the Simulator… The Editor consists of four parts: Model tab / Library tab … **Graphical Editor
    / Equation Editor**: At the lowest level of the hierarchy this editor will show the model equations. In
    the higher levels this editor will show the graphical parts of your model…"
  - Connection creation ([Graphical Editor](https://20sim.com/webhelp/editor_introduction_graphical_editor.php)
    / Reference Manual §7.2.6): "In 20-sim, submodels can be connected using the mouse. **When a connection
    is created it will be displayed using straight lines.** When a connection has been made you can change it
    into a **smooth line** using the right mouse menu." "While dragging from the first submodel to the
    second, you can click the left mouse button … to **create intermediate points**." ⇒ manual bend points +
    optional smoothing; **no auto-routing documented**.
  - ⭐ **Acausal semantics — directly relevant.** "**20-sim will automatically detect which connection has to
    be made: a signal, a bond or an iconic diagram connection.** Depending on the physical domain, every
    connection will have a specific color." And:
    > "**Analyze Causality** — Causal analysis is the procedure to get the model equations [in] correct
    > form. For Bond Graph models this means that the direction of the efforts and flows of the bonds have to
    > be determined. The result of the analysis is displayed by **causal strokes** (denoted by |). For Iconic
    > Diagrams this means that the direction of the across and through variables of the connections have to
    > be determined. The result … is displayed by **causal arrows** (denoted by ->)."

    > ➡️ **This is exactly the acausal mental model a Modelica editor needs**: connections are drawn with
    > **no inherent direction**, and *direction is computed afterwards and overlaid as a separate visual
    > layer*. A Modelica editor could offer the same affordance — display causalized flow direction as a
    > **derived, non-persisted overlay**, never as stored annotation.
  - Persistence: 20-sim uses its own `.emx` format (**not** Modelica); supports **FMI/FMU import/export** and
    a **Python scripting** interface (`controllab` package). ⚠️ **UNVERIFIED:** any claim that 20-sim
    reads/writes Modelica `connect()` annotations — no such statement was found.
- **Vendor/status:** Controllab Products B.V., Enschede, Netherlands (<https://www.controllab.nl>); 20-sim
  5.1 documentation © 2026 and actively maintained; a bond-graph/acausal modelling and simulation package.
  ⚠️ The "originating from the University of Twente" claim was **not verified** from a primary source.

### 2.3.7 PTC Mathcad — ⚠️ **not a block-diagram tool; exclude from comparison**

- **Verified from PTC's own product page** (<https://www.ptc.com/en/products/mathcad>): the page contains
  **zero** occurrences of "block diagram", "diagram" or "schematic" (verified by text extraction). It
  describes Mathcad as an engineering calculation notebook:
  > "Document your calculations in an engineering notebook with natural mathematical notation and units
  > intelligence. Show your work using rich formatting options alongside **plots**, text, and images in a
  > single, professionally formatted document."
  > "**Plots and charts** — Mathcad Prime comes with several plotting options, ranging from 2D XY charts to
  > 3D plots, as well as polar plots and contour plots."
- **The distinction to state:** Mathcad has *plots/charts* (data visualization) and **none** of the editable
  block-diagram / schematic capture a Modelica editor needs — **no components, no connectors, no `connect()`
  semantics, no diagram annotations.**
- **Rendering technology: N/A** — deliberately not researched, as there is no diagram editor to model.
- **For completeness, where PTC's diagramming actually lives:** PTC ships **Creo Schematics** for 2-D
  schematic capture — "Creo Schematics contains the rich breadth of **diagramming tools** to satisfy the
  needs of many disciplines and industries" / "Drive 3D routes from **2D schematic logic**"
  (<https://www.ptc.com/en/products/creo/schematics>). That is an **ECAD/cabling** schematic tool, a
  different product line, and **not** an acausal physical-modeling editor.
- **Vendor/status:** PTC Inc. "the latest version available is **PTC Mathcad Prime 12.0.1.0**" per PTC's
  page. ⚠️ The Mathsoft → PTC ownership history was **not verified** here from a primary source.

### 2.3.8 Cross-cutting takeaways for a web-based Modelica diagram editor

1. **The reference open-source implementation (OMEdit) uses an immediate-mode 2-D vector scene graph with
   `QPainter` drawing into items that map 1:1 onto Modelica graphic annotations**
   (`ShapeAnnotation`/`LineAnnotation` mirror `Rectangle`/`Ellipse`/`Polygon`/`Line`/`Text`/`Bitmap`). A
   browser equivalent (SVG/DOM or Canvas2D items) maps naturally; **nothing in OMEdit needs GPU 3-D for the
   diagram.** OMEdit's OpenGL/Quick3D/OSG usage is confined to the separate animation window.
2. **Only Simulink has a true obstacle-avoiding autorouter** ("smart signal routing", shortest path, minimal
   90° turns, minimum disturbance). OMEdit's "manhattanize" is a *local* L-bend repair; Dymola documents
   *automatic* manhattanize; MapleSim reroutes "to their simplest form" (L/Z); System Modeler draws
   right-angle lines by default; 20-sim is manual straight lines + optional smoothing.
   ➡️ **A web Modelica editor does not need Simulink's router to be credible — and no Modelica tool
   reviewed here documents obstacle avoidance at all.**
3. **Acausality is the differentiator to be explicit about.** MathWorks' own patent states signal-based
   Simulink connections are "directed lines, such as arrows", while physical modeling uses "non-directional
   physical connections"; 20-sim computes causality *after the fact* and overlays causal strokes/arrows;
   Dymola's manual has an "Acausal modeling" chapter. In Modelica, per §18.6.4, the connection's `Line`
   annotation is **presentation only** — so arrowheads, `smooth`, `points` and colours must **never** be
   allowed to imply direction of computation.
4. **Second-order details worth copying from OMEdit** (all seen in source): line colour defaulting from the
   source connector's first icon shape (Dymola does the same); Bezier smoothing for transitions; auto-removal
   of redundant/collinear points; collision handling between crossing connections (intersection nodes) and
   re-drawing connectors that collide with connections; and **instance-based rendering** (render from the
   *instantiated* model so conditional/parameterized connectors, inherited shapes and `IconMap`/`extends`
   extents resolve correctly).

# PART 3 — Adjacent research/modeling formats

## 3.0 Headline: is Modelica §18 the only option for diagram interchange?

**No — but it is the only one that standardizes *vector primitives*.**

| Standard | Diagram/graphics interchange? | What it actually standardizes | Acausal? |
|---|---|---|---|
| **Modelica MLS §18.6** | **YES — full** | Icon/Diagram layers, coordinate systems, `Placement`/`Transformation`, vector primitives (Line/Polygon/Rectangle/Ellipse/Text/Bitmap), fill/line patterns, connection `Line`+`Text` | Graphics neutral; acausality comes from the language (Ch. 9/15, App. C) |
| **FMI 3.0 §2.4.9** | **PARTIAL** | FMU icon (extent + PNG/SVG), **per-terminal icons** with extent, `defaultConnectionColor`, `defaultConnectionStrokeSize`, `CoordinateSystem`. **No vector primitives.** | Causal variables + acausal *terminal* layer (`inflow`/`outflow` = Kirchhoff; stream balance equations) |
| **SSP 2.0 §5** | **PARTIAL — deliberately "basic"** | `ElementGeometry`, `ConnectorGeometry` (normalized, inner+outer view), `ConnectionGeometry` (waypoints), `SystemGeometry` (canvas, nominal 1 mm), `GraphicalElements`/`Note`. **No vector primitives.** | Directional type system **plus** explicit acausal escape hatch: Modelica acausal connectors → `kind="unspecified"` |
| **SysML v2** | **NO** | Abstract syntax (XMI/JSON) + textual notation (`.sysml` inside `.kpar`). Graphical notation = BNF rules only; layout explicitly left to tools | N/A — not a simulation language |
| **OMG DI / DD** | **YES (framework), UML/MOF-specific** | UMLDI 1.0 (`formal`, 2006) + DI metamodel XMI under UML 2.5.1; DD 1.1 (`formal`, 2015) with DC/DG/DI XMI. "Framework… no conformance criteria to vendors directly" | N/A |
| **SBML L3 Layout + Render** | **YES — closest precedent** | Layout: glyph classes + `BoundingBox`/`Curve`/`LineSegment`/`CubicBezier`, stored in `ListOfLayouts` as a **child of `<model>`**. Render: graphical symbols/colours | N/A (biochemical networks) |
| **SBGN / SBGN-ML** | **YES (SBGN-ML)** | SBGN = notation semantics (PD/ER/AF); SBGN-ML = XML with `glyph`/`arc`/`bbox`/`point` | N/A |

**No FMI or SSP *layered standard* for graphics exists.** The authoritative FMI layered-standard list is
XCP / BUS / STRUCT / REF / DAE / WASM only (<https://fmi-standard.org/>); SSP has only
**SSP-LS-Traceability v1.0.0** (released 2025-08-29,
<https://ssp-standard.org/news/2025-08-29-ssp-ls-traceability-v1.0.0/>), which is metadata/traceability,
not graphics. Note `https://fmi-standard.org/layered-standards/` and
`https://ssp-standard.org/layered-standards/` both **404**.

> **Practical implication for the new editor:** write Modelica §18 annotations as the primary, lossless
> format; treat **FMI §2.4.9 `terminalsAndIcons.xml`** and **SSP §5 SSD geometry** as *derived export
> targets* — they round-trip *placement* and *terminal appearance* but **not icon vector content**.

## 3.1 FMI (Functional Mock-up Interface)

**What it is / status.** Modelica-Association standard for exchanging dynamic simulation models as a ZIP
containing XML + binaries + C code (<https://fmi-standard.org/>). Current spec **3.0.2**; 3.0.1 and 3.0.0
also published (<https://fmi-standard.org/docs/3.0.2/>). Three interface kinds:
`<ModelExchange>`, `<CoSimulation>`, `<ScheduledExecution>` (FMI 3.0.x §2.4 / §3.4 / §4.4 / §5.4).

**Does FMI define graphics? YES — §2.4.9 "Terminals and Icons".** Verified present in 3.0.1 and 3.0.2.
Section structure:

- **§2.4.9.1 Definition of a Graphical Representation**
  - §2.4.9.1.1 Overview · §2.4.9.1.2 `CoordinateSystem` · §2.4.9.1.3 `Icon` ·
    §2.4.9.1.4 Placement, Extent, and Painting Order of Graphical Items
- **§2.4.9.2 Definition of Terminals**
  - §2.4.9.2.1 Overview · §2.4.9.2.2 Terminals · §2.4.9.2.3 Terminal Member Variable ·
    §2.4.9.2.4 Terminal Stream Member Variable · **§2.4.9.2.5 Terminal Graphical Representation** ·
    §2.4.9.2.6 General Remark on Signal

Verbatim (FMI 3.0.x §2.4.9):

> "Terminals define semantic groups of variables… **It does not change the causality of the variables
> (e.g. inputs will remain inputs, outputs will remain outputs, and parameters will remain parameters)**
> but enables the definition of physical and bus-like connectors… **Icons define a graphical representation
> of an FMU and its terminals.**"

> "(§2.4.9.1.1) The graphical representation is fully optional… The element `<CoordinateSystem>` defines
> the extent of the whole icon, **graphical items may exceed that rectangle**."

> "(§2.4.9.1.2) The coordinate system default is `x1=-100, y1=-100, x2=100, y2=100`… The default
> `suggestedScalingFactorTo_mm` is `0.1`. So the default coordinate system display size should be
> **20 mm width and 20 mm height**." ← *Notice this is deliberately the same nominal-mm convention as
> Modelica's `DrawingUnit` (§1.2).*

> "(§2.4.9.1.3) The optional image file of the FMU icon is placed at the path `terminalsAndIcons/icon.png`
> in the ZIP archive of the FMU. The terminals should not be visible in the image. Optionally an SVG file
> with path `terminalsAndIcons/icon.svg` can be provided if also the PNG file is present."

> "(§2.4.9.1.4) The order of the elements in the XML file defines the **order of painting**. The first
> element in the `<TerminalGraphicalRepresentation>` is painted first and therefore behind the others."

> "(§2.4.9.2.5) The `iconBaseName` attribute is **mandatory**… The PNG file with the extension '.png' has
> to be provided. An additional SVG file with extension '.svg' is optional. The
> `defaultConnectionStrokeSize` and `defaultConnectionColor` can be provided to define the **intended
> connection line layout** in the importer. The stroke size is given relative to the coordinate system
> extent. The stroke color is given in RGB values from 0 to 255."

**Element/attribute names verified against the official XSD**
(`schema/fmi3Terminal.xsd`, `schema/fmi3TerminalsAndIcons.xsd`,
<https://github.com/modelica/fmi-standard/tree/main/schema>): `fmiTerminalsAndIcons`;
`GraphicalRepresentation` → `CoordinateSystem` (`x1`,`y1`,`x2`,`y2`,`suggestedScalingFactorTo_mm`),
`Icon` (`x1`,`y1`,`x2`,`y2`), `Annotations`; `Terminals` → `Terminal` (attrs `name`, `matchingRule`,
`terminalKind`, `description`); `TerminalMemberVariable` (`variableName`, `memberName`, `variableKind`);
`TerminalStreamMemberVariable` (`inStreamMemberName`, `outStreamMemberName`, `inStreamVariableName`,
`outStreamVariableName`); **`TerminalGraphicalRepresentation`** (`iconBaseName`,
`defaultConnectionColor`, `defaultConnectionStrokeSize`, `x1`,`y1`,`x2`,`y2`). Nested `Terminal` is
allowed (`maxOccurs="unbounded"`) ⇒ hierarchical terminals.

**⚠️ Not to be confused with diagram interchange:** the FMU ZIP layout (§2.5.1) includes
`documentation/diagram.png` / `documentation/diagram.svg` — "descriptive diagram view of the model
(optional)". That is a **static picture**, not machine-readable geometry.

**Acausal semantics inside FMI.** FMI is causal at the variable level, with an acausal physical layer
bolted on via Terminals:

- `variableKind ∈ { signal, inflow/outflow }`. Verbatim: "`inflow` / `outflow` — **Variables which fulfill
  Kirchhoff's current law.** Restricted to `input` and `output`, `parameter` and `calculatedParameter`.
  [Example: Electric current]".
- `TerminalStreamMemberVariable` carries the balance equation `0 = Σ qᵢ·ṁᵢ` and the spec **explicitly cites
  Modelica**: "The Stream concept is described in the appendix D 'Derivations of Stream Equations' of the
  Modelica Language Specification." It adds Modelica-specific guidance: "In Modelica the inStream variable
  is not directly visible, the value can only be accessed using `inStream()`, therefore an additional model
  variable has to be added during the export."
- **Direct Modelica interop hook — highly relevant to the editor (§2.4.9.2.5), verbatim:** "The
  `Annotations` element can be used by vendors to store additional information for the graphical
  representation. **[It is suggested that Modelica tools store the Modelica annotation of the connector
  under the type `org.modelica.Modelica4Annotation` in the annotations of an element `connector`.]**"
- `terminalKind` examples explicitly include Modelica connector types such as
  `Modelica.Mechanics.Translational.Interfaces.Flange_a`.
- FMI-LS-DAE adds genuine acausal-style semantics (algebraic variables + `<Residual>` equations,
  semi-explicit index-1 DAEs) but **no graphics**; the site still labels it `1.0.0-alpha.1` pre-release
  (<https://modelica.github.io/fmi-ls-dae/main/>).

**Verified / unverified.** ✅ Section numbering, XSD names, layered-standard list, quotes.
⚠️ The FMI **PDF** was not downloaded — the official HTML at `/docs/3.0.1/` and `/docs/3.0.2/` was used
(same normative text). ⚠️ Whether *third-party* FMI layered standards for graphics exist was **not**
checked (the FMI spec permits them without FMI-project involvement).

## 3.2 SSP (System Structure and Parameterization)

**What it is / status.** "a tool-independent format for the description, packaging and exchange of system
structures and their parameterization… a set of XML-based formats to describe a network of component
models with their signal flow and parametrization, as well as a ZIP-based packaging format." Sub-formats:
**SSD** (System Structure Description), **SSV**, **SSM**, **SSB**; package `.ssp`.
**SSP 2.0 released 2024-12-20** (<https://ssp-standard.org/docs/2.0/>,
<https://modelica.org/news/2025-01-08-ssp-20-released/>).
⚠️ `https://ssp-standard.org/docs/SSP2.0/` is a **404**; the correct URL is `/docs/2.0/`.

**Does SSP define diagram geometry? YES — deliberately lightweight.** Verified verbatim:

- **§5.2.1.1 `ConnectorGeometry`** — "Note that x and y coordinates are in a **normalized connector
  coordinate system**, where 0,0 is the lower-left corner of the containing model element, and 1,1 is the
  upper-right corner of the model element, **regardless of aspect ratio**." Carries `x`, `y` plus optional
  **`systemInnerX` / `systemInnerY`** for the *inside* view. "If defined, this ConnectorGeometry overrides
  any ConnectorGeometry of a System in a referenced SSD file or any port location defined by an FMU…"
- **§5.2.2 `ElementGeometry`** — component placement: `x1,y1,x2,y2`, **`rotation`** ("applied after
  flipping, where positive numbers indicate a counter clockwise rotation"), **`iconRotation`**, and `z`.
  Flipping is expressed by `x1 > x2` / `y1 > y2` (same trick as Modelica `Transformation.extent`).
- **§5.3.2.2 `ConnectionGeometry`** — "The start and end coordinates of the connection are derived
  automatically through the coordinates of the corresponding connectors. The only relevant geometry
  information provided by the connection geometry is a, by default empty, list of **intermediate waypoint
  coordinates**, which are to be interpreted as for the `svg:polyline` primitive." Attributes `pointsX`,
  `pointsY`.
- **§5.3.4 `SystemGeometry`** — "defines the **extent of the system canvas**… Different from
  ElementGeometry, where x1 > x2 and y1 > y2 indicate flipping, x1 < x2 and y1 < y2 **MUST** hold here."
  States the nominal unit: "the nominal unit of the coordinates is **1 mm** for all axis."
- **§5.3.5 `GraphicalElements`** → **§5.3.5.1 `Note`** — "purely graphical elements… which have no
  semantic impact… **Currently the only graphical element defined is the Note element**… but in the future
  more elements might be added."

**XSD names verified** in
<https://github.com/modelica/ssp-standard/blob/main/schema/SystemStructureDescription.xsd>:
`SystemStructureDescription`, `System`, `Component`, `Connectors`, `Connector`, `ConnectorGeometry`,
`Connections`, `Connection`, `ConnectionGeometry`, `ElementGeometry`, `SystemGeometry`,
`GraphicalElements`, `Note`, `Elements`, `DefaultExperiment`, `SignalDictionaries`,
`SignalDictionaryReference`, `ParameterBindings`, `ParameterMapping`, `Annotations`, `Units`,
`Enumerations`, `Clock`.

**Design intent — the money quote (§1.1 "Simplicity"), verbatim:**

> "SSP is focused on the possibility to exchange complete or partial topologies and parameters between
> different tools as simply as possible, while retaining essential information. **This optionally also
> includes basic graphical information, to ensure basic recognizability, while eschewing the complexities
> of full and exact graphical model exchange.** This approach also differentiates SSP from systems
> engineering standards like SysML…"

§1.3 lists "**Optional exchange of graphical information (similar display across tools)**".

**Connections: directional type system + explicit acausal escape hatch.**

- §5.3.2: "the terms **start** and **end** in the attribute names of the connector… do **not** denote
  directionality of the data flow implied by the connector. That is determined by the combination of the
  semantics of the actual connectors (variables/ports) connected and their `kind` attributes."
- §5.3.2.1 "Allowed Connections" is a **directional** allowed-pairs table (Source → Destination), with
  "Implementations **MUST NOT** specify connections that are not of one of the allowed combinations".
- **Acausal, verbatim (§5.2.1):** "Connectors of kind **`unspecified`** are used to define connectors for
  which the flow of information is either not yet specified, or is determined at runtime, **for example for
  acausal connections of Modelica models**. Such connectors can be connected to any other connector under
  the rules of the underlying modeling language."
- **Acausal, verbatim (Modelica mapping):** "**Acausal Modelica connector types are mapped to connectors of
  kind `unspecified`.**" §5.3.2.1 adds: for `unspecified`, "it is ultimately **implementation-defined**
  whether and how connections are allowed… they serve a **wild-card role**."
- The SSP 2.0 release news confirms: SSP 2.0 adds "**support for both causal and acausal connection
  semantics**".
- **Correction to the brief:** SSP is *not* purely causal.
- FMI's own spec clarifies: "The System Structure & Parameterization Standard (SSP) refers to a
  `connectorKind`. This `connectorKind` is not related to the `terminalKind` or `variableKind` described
  in Section 2.4.9.2.2 and Section 2.4.9.2.3."

**SSP + Modelica.** SSP 2.0 §1.5 "Changes in 2.0.0" adds "Support in the core standard for **Modelica
models as components**" and "Support for the mapping of complex Modelica types in interfaces to binary
connectors in SSP". Built-in `RealInput`/`RealOutput`/… map to `ssc:Real`/`ssc:Integer` with kinds
`input`/`output`; "Modelica connectors of more advanced types are currently mapped in the following way:
The connector type is `ssc:Binary`. The media type is `text/x-modelica` and the path parameter of the media
type designates the path of the Modelica connector." The spec flags this as provisional: "[Note that the
current opaque mapping of more advanced types to Binary connectors is a temporary solution…]"

**⚠️ OMEdit already reads/writes SSP.** The OpenModelica User's Guide documents *File ▸ New ▸ New SSP
Model*, an **SSP menu** (Add System, **Add/Edit Icon**, Delete Icon, Add Connector, Add Bus, Add TLM Bus,
Add SubModel), and *OMSimulator/SSP Options* — and `LineAnnotation.cpp` branches on
`getLibraryTreeItem()->isSSP()` to call `updateOMSConnection()` instead of `updateConnectionAnnotation()`.
So SSP-editing is a first-class mode in OMEdit, implemented through OMSimulator rather than through
Modelica text.

**Verified / unverified.** ✅ §5.2.1.1/§5.2.2/§5.3.2.2/§5.3.4/§5.3.5 text, allowed-connections table,
XSD names, acausal quotes, SSP-LS-Traceability subject matter. ⚠️ No SSP layered-standards index page
exists, so "no graphics layered standard" rests on the spec + news pages. ⚠️ SSP 1.0↔2.0 XSD diff was not
performed.

## 3.3 SysML v2 / KerML — **no diagram interchange**

**Status.** OMG SysML **2.0 is formal, published September 2025**
(<https://www.omg.org/spec/SysML/>); normative documents are only "Specification – Language"
(`formal/26-03-02`) and "Specification – Transformation" (`formal/26-03-03`).

**Verified negative:** a full-text grep of the **691-page** SysML v2 Language PDF finds **zero occurrences
of "diagram interchange"**. §8.2.3 "Graphical Notation" (27 subclauses, pp. 193–255) defines a
**"graphical BNF"**, not a serialized layout format — verbatim: "**Shapes within the graphical notation may
generally be relocated anywhere within a given graphical layout.**"

Conformance is deliberate: "**Graphical Notation Conformance.** A tool… provides Concrete Syntax
Conformance for the SysML graphical notation…" — a **UI/API requirement, not a file format**. Model
interchange is "a **project interchange file** as specified in [KerML, Clause 10]… The project interchange
file shall use the standard **`.kpar`** (KerML Project Archive) extension… Textual notation files shall use
the extension **`.sysml`**." SysML v2 "diagrams" are model-level **view usages**
(`asInterconnectionDiagram` §9.2.19.2.2, `asTreeDiagram` §9.2.19.2.4) — semantic renderings, not stored
geometry.

**Not a fit for acausal physics** — SysML v2 has `Connection`/`Interface`/`Flow`/`Port`, but these are
declarative structural constructs without conserved-quantity (Kirchhoff) semantics.

⚠️ **Unverified:** whether an OMG **RFP** for SysML v2 diagram interchange is *in progress*. What is
verified is that none is *published*.

## 3.4 OMG DI / DD — a live precedent, not a dead one

**Correction to the brief: OMG DI is not dead.** Two live artifacts:

1. **OMG UML Diagram Interchange (UMLDI) v1.0** — <https://www.omg.org/spec/UMLDI/>. **Status: `formal`,
   April 2006.** PDF live at <https://www.omg.org/spec/UMLDI/1.0/PDF>. Goal, verbatim: "to enable a smooth
   and seamless exchange of documents compliant to the UML standard… between different software tools.
   While this certainly includes tools for developing UML models, it also includes tools such as whiteboard
   tools, code generators, word processing tools, and desktop publishing tools."
2. **UML 2.5.1 ships a normative "UML 2.5.1 Diagram Interchange Metamodel"**:
   <https://www.omg.org/spec/UML/20161101/UMLDI.xmi> (`ptc/18-01-04`), under *Normative Machine Readable
   Documents* on <https://www.omg.org/spec/UML/2.5.1/>.
3. **OMG DD (Diagram Definition) 1.1** — <https://www.omg.org/spec/DD/>. **Status: `formal`, August 2015**
   (`formal/15-06-01`). Metamodels: **`DC.xmi`** (Diagram Common), **`DG.xmi`** (Diagram Graph),
   **`DI.xmi`** (Diagram Interchange) — <https://www.omg.org/spec/DD/20131001/DI.xmi>. Verbatim: "**the DD
   specification does not have conformance criteria to vendors and tools directly, but rather to the
   modeling language specifications using it.**"

**On UML 2.5:** OMG issue **UML25-591 "Compliance points – Diagram Interchange"**
(<https://issues.omg.org/issues/UML25-591>) is **closed**; its summary (from the then-Chair of the Diagram
Interchange FTF) records that the Superstructure FTF "**plans to revoke Diagram Interchange as a compliance
point to UML 2 compliance**". Disposition: **"Closed – No Change."**

⚠️ **State this carefully:** DI is no longer a *UML 2.5 compliance point*, but the DI metamodel is still a
normative machine-readable document for UML 2.5.1 and UMLDI 1.0 remains `formal`. Do **not** assert
"UML 2.5 removed Diagram Interchange" as a flat fact; the OMG disposition text is ambiguous.

**Relevance:** OMG DI/DD is **UML/MOF-specific** (XMI + UML metamodel references) and unusable for Modelica
without a full MOF metamodel of Modelica, which does not exist as an OMG standard. Its value is as a
**precedent**: a general-purpose DI metamodel was tried, kept alive as a standalone normative document, and
its adoption depends on each language spec opting in — which SysML v2 declined to do.

## 3.5 SBML Layout / Render / SBGN — the closest precedent

**This is the strongest precedent**, because SBML faced exactly Modelica's problem and solved it the same
way Modelica has (annotations), then standardized it.

**SBML Level 3 Layout Package v1r1 — status FINAL**, published **13 August 2013**
(<https://sbml.org/documents/specifications/level-3/version-1/layout/>;
spec PDF: <https://identifiers.org/combine.specifications:sbml.level-3.version-1.layout.version-1.release-1>).
"Package status: **Final specification approved and two independent implementations are available**."
Purpose, verbatim: "**Support for storing the spatial topology of a network diagram**".

**SBML Level 3 Render Package v1r1 — status FINAL**, published **21 November 2017**
(<https://sbml.org/documents/specifications/level-3/version-1/render/>). "**Final specification approved**
and two independent implementations are available… considered stable and in use." Purpose, verbatim:
"**Support for defining the graphical symbols and glyphs used in a diagram of the model**".

**Element names verified by grepping the official Layout spec PDF** (occurrence counts): `Layout` (229),
`GraphicalObject` (50), `ReactionGlyph` (46), `GeneralGlyph` (44), `SpeciesGlyph` (41), `TextGlyph` (36),
`CompartmentGlyph` (34), `BoundingBox` (33), `LineSegment` (31), `SpeciesReferenceGlyph` (29),
`ReferenceGlyph` (29), `CubicBezier` (29), `Curve` (28), `Dimensions` (25), `Point` (24); plus
`ListOfLayouts`, `ListOfCompartmentGlyphs`, `ListOfSpeciesGlyphs`, `ListOfReactionGlyphs`,
`ListOfTextGlyphs`, `ListOfAdditionalGraphicalObjects`.

**Do these store layout INSIDE the model file? YES — and the spec says why (verbatim, §2 "Background and
context"):**

> "**Currently, there is no official way of encoding the graphical layout of computational models in an
> SBML document. Software tools wishing to share this kind of data must use SBML annotations to store it in
> proprietary forms.** The Layout proposal was made in early 2003… For example, users requested that
> several layouts could be stored in one SBML file, and so the layout data is stored in a `ListOfLayouts`
> as a **child of the `Model` element instead of being direct annotations on the Model constituents**."

> "(§3.6) The `Layout` class stores layout information for some or all elements of the SBML model as well
> as additional objects that need not be connected to the model."

> "(§3.5–3.6) Should the Layout package be used in an SBML Level 2 model, the `ListOfLayouts` needs to be
> placed in an **Annotation** on the Model element."

That last quote *is* the Modelica situation: layout once lived in proprietary annotations; the package
promoted it to a standardized first-class child of `<model>`. The spec also explicitly **rejected reusing
SVG**: "The layout of a reaction network diagram should be described as graphical representations of
species and reactions (and not as arbitrary drawing or graph). This means that existing languages for the
description of vector drawings (SVG) or general graphs cannot be used." — a directly relevant argument if
anyone proposes "just store an SVG blob in an annotation".

**SBGN** (<https://sbgn.github.io/>) — "an effort to **standardise the graphical notation** used in maps of
biological processes." Three languages: **Process Description (PD)**, **Entity Relationship (ER)**,
**Activity Flow (AF)**. Current specs (<https://sbgn.github.io/specifications>): PD L1V2.1 (2026-01-23),
ER L1V2.0 (2015), AF L1V1.2 (2015).

**⚠️ CRITICAL DISTINCTION: SBGN is the *notation*; SBGN-ML is the *file format*.** SBGN-ML's XSD is at
<https://raw.githubusercontent.com/sbgn/libsbgn/master/resources/SBGN.xsd>, header verbatim:
`targetNamespace="http://sbgn.org/libsbgn/0.3"`, "**SBGN-ML is an XML implementation of the Systems Biology
Graphical Notation.** … Version: **LibSBGN Milestone 3**". Verified elements: `sbgn`, `map`, `glyph`,
`arc`, `arcgroup`, `bbox`, `point`, `start`, `end`, `next`, `label`, `callout`, `clone`, `entity`, `state`,
`port`, `extension`, `notes`. Geometry **is** stored (`glyph`→`bbox`; `arc`→start/end/next `point`s). The
SBGN-ML XSD **imports the SBML Render schema**:
`<xsd:import namespace="http://www.sbml.org/sbml/level3/version1/render/version1" schemaLocation="./render.xsd" />`.

**Verified / unverified.** ✅ Layout & Render final status, dates, purposes, URLs, all cited Layout element
names, the `ListOfLayouts`-child-of-`Model` decision and its rationale, the SVG-rejection rationale,
SBGN's three languages and current versions, SBGN-ML namespace/version/elements, the SBGN-ML→SBML Render
XSD import. ⚠️ **SBGN-ML has no formal SDO designation** — it is a community/specification-level format
published via a journal article, not an ISO/OMG-style standard. ⚠️ The **Render** package's own element
list (`RenderInformation`, `GlobalRenderInformation`, `LocalStyle`, `ColorDefinition`, …) was **not**
verified from its PDF; only its status, purpose, URL and namespace are asserted.

## 3.6 GraphicalModelica, ModelicaML, MoDeSt

### ModelicaML — real, documented, but **dormant and not browser-reusable**

- **What it is**, verbatim from the official page
  (<https://openmodelica.org/free-and-open-source-software/modelica-modeling-language-modelicaml/>):
  "ModelicaML - A UML Profile for Modelica … a **graphical** modeling language for the description of
  time-continuous and time-discrete/event-based system dynamics. ModelicaML is defined as an extended
  subset of the OMG Unified Modeling Language (UML). **This subset enables the generation of executable
  Modelica code.**"
- **Status: dormant/legacy.** Downloads target **Eclipse Juno (2012)** and **Papyrus MDT 0.9**; update site
  at `ida.liu.se`; source on OpenModelica Trac **SVN** (`trac.openmodelica.org/MDT/browser/trunk/modelicaml/…`,
  revisions ~1600–1800). **No GitHub repo exists** — `OpenModelica/ModelicaML`, `modelica/ModelicaML`,
  `adrpo/ModelicaML` all 404. ⚠️ Exact last-release date **unverified**.
- **Relevance to a Modelica diagram editor: conceptually relevant, practically obsolete.** It is the main
  prior art for *graphical* Modelica notations **beyond** Icon/Diagram (UML composition / connection /
  inheritance / behaviour diagrams that generate Modelica code) — but its stack (Eclipse + Papyrus + Xtext +
  SVN) is not browser-reusable and it does **not** model the §18 Icon/Diagram annotation format at all.
  Key papers: Schamai/Fritzson et al., "Towards Unified System Modeling and Simulation with ModelicaML";
  Pop et al. on ModelicaML/UML.

### GraphicalModelica — ⚠️ **could not be verified as a real project**

Targeted searches for the literal term "GraphicalModelica" returned **no distinct project, repository, or
publication** — only query echoes. The nearest real matches are (a) **ModelicaML** (above), described as a
*graphical* modeling language / UML profile and associated with "graphical notations" in
Schamai/Fritzson/Pop papers, and (b) Modiator/Playmola's *graphical* Modelica work (§2.2.3, §2.2.9).
**Recommendation: treat "GraphicalModelica" as either a conflation with ModelicaML or a non-existent /
renamed project until a primary source is produced. Do not cite it as a Modelica diagram format.**

### MoDeSt — ⚠️ **a same-acronym false friend; not Modelica-related**

- **MoDeST** = *"A Modelling and Description Language for Stochastic Timed Systems"* (D'Argenio, Katoen,
  Klaren, Bohnenkamp, Bortnik) — "a compositional modeling formalism for real-time and stochastic systems".
  Its successor/related toolset is the **Modest Toolset** (<https://www.modestchecker.net/>), *"a modular
  framework centered around the stochastic hybrid automata formalism and supporting the JANI
  specification"*, latest release **v3.1.311 (June 2026)** — i.e. actively maintained, but for stochastic
  **model checking**.
- **RELATION TO MODELICA: NONE FOUND.** No Modelica integration or interoperability was discovered.
  ⚠️ This is an *absence-of-evidence* finding, not a proof of absence — but there is no reason to cite
  MoDeSt in a Modelica diagram-editor report. **Recommend excluding it.**

### Modelica Association standardization of diagram interchange: none

- **No MA Project for graphics or diagram interchange.** <https://modelica.org/association/> lists exactly:
  **Modelica Language, Modelica Libraries, FMI, SSP, DCP, eFMI**.
- **`https://modelica.org/projects/` is a 404.** The real page,
  <https://modelica.org/community/projects/>, lists only **externally funded research** projects
  (OpenSCALING, PHyMoS, MOSIM, ModeliScale, UPSIM, EMPHYSIS, ACOSAR, MODRIO, OPENPROD, MODELISAR,
  EUROSYSLIB) — none about graphics.
- **The `modelica` GitHub org contains no graphics/diagram/SVG/rendering/interchange repo** (full
  enumeration in §2.2.8). The layered-standards track covers bus, DAE, ref, struct, wasm + SSP
  traceability — **no graphics**.
- ⚠️ **UNVERIFIED:** whether some *informal* MA interest group exists outside the public project list. No
  "MDI" / "Modelica Diagram Interchange" standard was found anywhere.

> **Net conclusion for Part 3:** the interchange format for Modelica diagrams **is the annotated Modelica
> source text** (§18.6 / §18.9). FMI §2.4.9 and SSP §5 are real, standardized, *complementary* targets for
> **placement and terminal appearance** — and are the right targets if the editor must round-trip into the
> co-simulation world — but **neither can carry an icon's vector graphics**. The **SBML Layout + Render**
> packages (§3.5) are the best-documented precedent for how to argue that annotation-embedded diagram data
> should be promoted into a standardized first-class format.

---
