<div align="center">

# FlowJo SweetSpot Web

### Functional flow cytometry panel optimization for CHO cells

<br>

**[→ Open the live app](https://ebalderasr.github.io/flowjo-sweetspot-web/)**

<br>

[![Stack](https://img.shields.io/badge/Stack-Plotly_·_XLSX.js_·_Vanilla_JS-4A90D9?style=for-the-badge)]()
[![Focus](https://img.shields.io/badge/Focus-Flow_Cytometry_·_CHO_·_Panel_Optimization-34C759?style=for-the-badge)]()
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](./LICENSE)
[![Part of](https://img.shields.io/badge/Part_of-HostCell_Lab_Suite-5856D6?style=for-the-badge)](https://github.com/ebalderasr)

</div>

---

## What is FlowJo SweetSpot Web?

FlowJo SweetSpot Web is a **browser-based panel optimization tool** for functional flow cytometry in CHO cell cultures. Upload a FlowJo single-stain titration export and it identifies the optimal concentration for each dye — the one that maximizes the fraction of cells detected in the target channel while minimizing spectral contamination of the other channels.

It runs entirely in the browser through vanilla JavaScript. No installation, no server, no data leaves your machine.

---

## Why Stain Index is not enough

The standard metric for panel optimization is the **Stain Index** (SI):

$$SI = \frac{MFI_{stained+} - MFI_{unstained-}}{2 \times rSD_{unstained-}}$$

SI answers one question: *how far above the noise floor is the stained population?* It was designed for assays with discrete positive and negative populations — surface markers, viability dyes — where the goal is to place the two clusters as far apart as possible.

**Functional and physiological markers behave differently.** TMRM (mitochondrial potential), Bodipy (lipid content), CellRox Deep Red (oxidative stress), and GFP reporter expression do not produce a bimodal distribution. Instead, the entire cell population shifts as a unit. There is no true negative subpopulation in the stained sample. The distribution is **continuous and unimodal**.

In this context, maximizing SI means maximizing absolute brightness — using as much dye as possible. This creates four compounding problems:

| Problem | Mechanism | Consequence |
|---|---|---|
| **Detector saturation** | High brightness pushes the signal toward the instrument ceiling | Cells that differ biologically are compressed into the same voltage range; biological variation becomes invisible |
| **Spreading error** | Brighter signals generate more photon shot noise and electronic noise in adjacent channels | Other dyes' distributions widen, reducing their resolution |
| **Hidden heterogeneity** | The distribution compresses at high brightness | Cell-to-cell differences in metabolic state — the whole point of the assay — are obscured |
| **Multivariate corruption** | One dye's spreading error invades another channel | Mitochondrial potential, lipid content, and ROS can no longer be treated as independent measurements in joint analysis |

The objective is not to maximize signal. It is to **find the lowest concentration that still captures as much of the population as possible, while introducing the least contamination into the other channels**. Stain Index cannot answer that question directly.

---

## How it works

### 1. Prepare the FlowJo export

In FlowJo, set up the following gate structure under your parent gate (e.g. `CHO/Singlets`):

```
CHO/Singlets
├── GFP-A+       GFP-A-
├── PE-A+        PE-A-
├── SNARF-A+     SNARF-A-
└── APC-A+       APC-A-
```

In the Table Editor, export for each sample the following statistics per gate:

- `Freq. of Parent`
- `Median ({channel})`
- `Robust SD ({channel})`

Add three metadata columns: **Sample**, **Colorante** (dye name), and **Concentracion** (concentration). Include one row per stained sample and one row for the unstained control with `Colorante = ST`.

Export as `.csv` or `.xlsx`. One sheet, one row per sample.

> The app recognizes English aliases automatically: `Dye`, `Stain`, `Marker` for the dye column; `Concentration`, `Dose` for the concentration column.

### 2. Configure

| Parameter | Description | Default |
|---|---|---|
| **Population base** | Parent gate path as it appears in column names | `CHO/Singlets` |
| **Detector max** | Upper instrument limit for saturation estimation | `1 000 000` |
| **Minimum acceptable SI** | SI floor below which a concentration is penalized | `7` |
| **Target channel** | Detector channel for each dye | editable per dye |

GFP is marked `informational_only`: its expression level is set by the biology of the cell, not by a titrable dose. It participates in invasion calculations — its spill can reach other channels, and other dyes can spill into its channel — but no concentration selection is performed for it.

### 3. Run the analysis

Click **Run analysis**. For each stained sample (dye × concentration × clone), the engine computes:

- Stain Index against the unstained control
- Fraction of cells in the target channel's positive gate
- Fraction of cells falling in each neighbor channel's positive gate (invasion)
- Score, saturation envelope, and selection outcome

### 4. Read the results

**Cards** at the top show the recommended concentration for each dye with a one-line interpretation.

**Metric trends plot** (3 panels, top to bottom):

1. **Stain Index** — reference signal quality against the unstained control
2. **Invasion total** — fraction of cells appearing in non-target positive gates; lower is better
3. **Score** — the combined metric; the **peak of this curve is the recommended concentration**

**Selection criteria plot** — one panel per dye showing the Score curve across concentrations, with the selected condition marked.

**Best conditions table** — final recommendation with Score, % positivas, invasion total, SI, and saturation flags per dye.

**Ws breakdown table** — per-neighbor invasion detail: frequency of cells invading each neighbor channel and the apparent SI in that channel (diagnostic).

---

## Methods

### Stain Index

$$SI = \frac{MFI_{stained+} - MFI_{ST-}}{2 \times rSD_{ST-}}$$

Where $MFI_{stained+}$ is the median of the stained sample's positive gate, and $MFI_{ST-}$ and $rSD_{ST-}$ are the median and robust standard deviation of the **unstained control's negative gate**. The unstained control provides the noise floor reference for all dyes in the panel simultaneously.

SI is used as a **correction factor**, not as the primary decision driver. See SI factor below.

### Saturation envelope

$$UpperEnvelope = MFI_{stained+} + k \times rSD_{stained+} \quad (k = 2)$$

A concentration is flagged as `Clip_Risk` when $UpperEnvelope \geq detector\_max$, and as `Near_Clip` when $UpperEnvelope \geq 0.9 \times detector\_max$. Clip-risk concentrations are excluded from the candidate pool when alternatives exist.

### Freq\_Signal

$$Freq\_Signal = \frac{\text{cells in target}+ \text{ gate}}{\text{parent cells}} \in [0, 1]$$

The primary signal metric: **what fraction of the population is being captured in the target channel at this concentration?** More is better — a higher fraction means more of the biological heterogeneity is represented in the measurement.

### Invasion\_Total

For each neighbor channel $j \neq$ target:

$$FreqInvasion_j = \frac{\text{cells in channel}_j\text{+ gate for this stained sample}}{\text{parent cells}}$$

$$Invasion\_Total = \sum_{j \neq target} FreqInvasion_j$$

This measures **how much of the population is being falsely detected in the wrong channels** due to spectral spillover at this concentration. Lower is better.

> **Apparent SI (diagnostic only):** for each neighbor $j$, the app also computes how strongly the invading signal appears in that channel:
> $$ApparentSI_j = \frac{MFI_{j,stained+} - MFI_{j,ST-}}{2 \times rSD_{j,ST-}}$$
> This is stored in the Ws breakdown table and useful for identifying which neighbors are most affected, but it does not enter the Score calculation.

### SI factor

$$SI\_factor = \min\!\left(\max\!\left(\frac{SI}{SI_{min}},\, 0\right),\, 1\right)$$

A soft gate on signal quality. It ramps linearly from 0 to 1 as SI goes from 0 to $SI_{min}$ (the minimum acceptable SI configured by the user), then stays fixed at 1 for any concentration above the threshold. This means:

- A concentration with insufficient signal is **penalized proportionally** — it cannot win if better options exist
- A concentration that exceeds the threshold is **not further rewarded** — extra brightness beyond the minimum does not improve the score

### Score

$$\boxed{Score = \frac{Freq\_Signal}{1 + Invasion\_Total} \times SI\_factor}$$

The score captures the three-way balance the experiment actually requires:

| Component | Behavior |
|---|---|
| $Freq\_Signal \uparrow$ | More cells detected → Score rises |
| $Invasion\_Total \uparrow$ | More cells in wrong channels → Score falls |
| $SI\_factor < 1$ | Insufficient signal → Score reduced proportionally |
| $SI\_factor = 1$ | Signal is adequate → frequencies alone drive the decision |

The optimal concentration is the one that places the most cells in the right channel, while spilling the fewest into others, given that the signal clears the minimum quality threshold.

### Selection algorithm

Given all concentrations for a dye:

1. **Safety filter:** remove concentrations with `Clip_Risk = True` if any safe alternatives exist; then prefer non-`Near_Clip` concentrations
2. **SI floor:** if any candidate achieves $SI \geq SI_{min}$, restrict the candidate pool to those; otherwise retain all (status `BELOW_SI_THRESHOLD`)
3. **Data quality:** prefer candidates with fewer neighbor channels with missing invasion data
4. **Select:** $\arg\max(Score)$ within the candidate pool

---

## Features

| | |
|---|---|
| **Zero installation** | Runs fully client-side — no Python, no pip, no server |
| **Frequency-first scoring** | Decision is based on population behavior, not signal intensity alone |
| **SI as correction factor** | Stain Index gates insufficient signal without over-rewarding brightness |
| **Saturation detection** | Upper envelope flags concentrations near or at the detector ceiling |
| **GFP-aware** | Recombinant reporter participates in invasion estimates but is not titrated |
| **Clone support** | Multiple CHO clones in the same export are tracked separately |
| **Interactive plots** | Plotly-powered; zoom, hover, and compare conditions |
| **CSV / XLSX input** | Accepts both formats; auto-detects percentage vs. fraction frequency scale |
| **Downloadable results** | Best conditions and full results exported as CSV in one click |
| **No data upload** | Everything runs locally in the browser — no data leaves your machine |

---

## Input format

### FlowJo export columns

The app expects one row per stained sample. Column names are constructed from the **Population base** and **channel** settings.

**Metadata columns** (required)

| Column | Aliases | Description |
|---|---|---|
| `Sample` | — | Sample or file name |
| `Colorante` | `Dye`, `Stain`, `Marker` | Dye name (see canonical names below) |
| `Concentracion` | `Concentration`, `Dose` | Concentration or identifier |

**Gate statistics per channel** (required for each dye in the panel)

Using `CHO/Singlets` as population base and `PE-A` as an example channel:

| Column | Description |
|---|---|
| `CHO/Singlets/PE-A+ \| Freq. of Parent` | Fraction of cells in the positive gate |
| `CHO/Singlets/PE-A+ \| Median (PE-A)` | Median fluorescence of the positive gate |
| `CHO/Singlets/PE-A+ \| Robust SD (PE-A)` | Robust SD of the positive gate |
| `CHO/Singlets/PE-A- \| Median (PE-A)` | Median fluorescence of the negative gate |
| `CHO/Singlets/PE-A- \| Robust SD (PE-A)` | Robust SD of the negative gate |

### Canonical dye names

The following names are recognized (case-insensitive):

| Input name | Canonical name | Default channel |
|---|---|---|
| `ST`, `unstained`, `Control ST unstained` | Unstained control | — |
| `GFP` | GFP (proteina recombinante) | `GFP-A` |
| `TMRM` | TMRM | `PE-A` |
| `Bodipy` | Bodipy | `SNARF-A` |
| `CellRox`, `CellRox Deep Red` | CellRox Deep Red | `APC-A` |

Channels can be reassigned in the **Dye configuration** table without editing the file.

---

## Tech stack

**Analysis and visualization**

![Plotly](https://img.shields.io/badge/Plotly.js-3F4F75?style=flat-square&logo=plotly&logoColor=white)
![XLSX](https://img.shields.io/badge/SheetJS_XLSX-217346?style=flat-square&logo=microsoftexcel&logoColor=white)

**Frontend**

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)

---

## Project structure

```
flowjo-sweetspot-web/
├── index.html      ← markup and help panels
├── styles.css      ← all custom styles
└── app.js          ← analysis engine, UI logic, and plots
```

---

## Author

**Emiliano Balderas Ramírez**
Bioengineer · PhD Candidate in Biochemical Sciences
Instituto de Biotecnología (IBt), UNAM

[![LinkedIn](https://img.shields.io/badge/LinkedIn-emilianobalderas-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/emilianobalderas/)
[![Email](https://img.shields.io/badge/Email-ebalderas%40live.com.mx-D14836?style=flat-square&logo=gmail&logoColor=white)](mailto:ebalderas@live.com.mx)

---

## Related

[**Clonalyzer 2**](https://github.com/ebalderasr/Clonalyzer-2) — Fed-batch kinetics analysis for CHO cultures: specific rates, yields, and integral cell counts from a single CSV drop.

[**CellSplit**](https://github.com/ebalderasr/CellSplit) — Neubauer cell counting and passage planning for CHO cultures.

[**CellBlock**](https://github.com/ebalderasr/CellBlock) — Shared biosafety cabinet scheduling for cell culture research groups.

---

<div align="center"><i>FlowJo SweetSpot Web — drop a titration export, find the sweet spot.</i></div>
