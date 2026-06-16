/* Aloud — publication template registry (window.PR_TEMPLATES).
 *
 * Each entry is a one-click "Sample Project" for a WoS/Scopus-indexed venue (or a
 * generic starting point). An entry carries:
 *   - a real LaTeX skeleton (\documentclass is the publisher's actual class; the
 *     class file is fetched on demand by the SwiftLaTeX/TeXlyre package server, so
 *     we never vendor — and never violate the licence of — publisher class files);
 *   - `limits`: machine-checkable format constraints the KPI panel auto-tracks
 *     (page/word/abstract/keyword caps, columns, reference style, required sections);
 *   - `journalMeta`: editable Tier-B bibliometric reference data (JIF/CiteScore/SJR/
 *     quartile/h-index/acceptance/APC/OA/indexing) with an as-of year, source and
 *     confidence — values are reference-only and MUST be user-verifiable.
 *
 * Bibliometrics are the fact-checked 2024 JCR / Scopus / Scimago figures from the
 * accompanying research note (docs/PUBLICATION_TEMPLATES_AND_KPIS.md). They go stale
 * yearly — treat as a starting point, not ground truth.
 */
window.PR_TEMPLATES = (function () {
  'use strict';

  /* ----- shared, class-neutral manuscript body (compiles with no external assets) ----- */
  var BIB = String.raw`@article{hendrycks2017baseline,
  title   = {A Baseline for Detecting Misclassified and Out-of-Distribution Examples in Neural Networks},
  author  = {Hendrycks, Dan and Gimpel, Kevin},
  journal = {International Conference on Learning Representations},
  year    = {2017}
}
@article{liang2018odin,
  title   = {Enhancing the Reliability of Out-of-distribution Image Detection in Neural Networks},
  author  = {Liang, Shiyu and Li, Yixuan and Srikant, R.},
  journal = {International Conference on Learning Representations},
  year    = {2018}
}
@article{lee2018mahalanobis,
  title   = {A Simple Unified Framework for Detecting Out-of-Distribution Samples and Adversarial Attacks},
  author  = {Lee, Kimin and Lee, Kibok and Lee, Honglak and Shin, Jinwoo},
  journal = {Advances in Neural Information Processing Systems},
  year    = {2018}
}
@article{yang2024openood,
  title   = {OpenOOD: Benchmarking Generalized Out-of-Distribution Detection},
  author  = {Yang, Jingkang and others},
  journal = {IEEE Transactions on Pattern Analysis and Machine Intelligence},
  year    = {2024}
}
`;

  // IMRaD middle shared by every family: intro, related work, method (equation),
  // experiments (figure + table), conclusion. Uses only standard packages and a
  // \rule placeholder so it typesets with no image assets.
  function body(opts) {
    opts = opts || {};
    var fig = String.raw`
\begin{figure}[t]
\centering
\rule{0.78\linewidth}{3.4cm}
\caption{Detection performance versus the score threshold. Replace this placeholder
with your own result plot. The proposed fusion (solid) dominates the single-feature
baseline (dashed) across the operating range.}
\label{fig:roc}
\end{figure}`;
    var tab = String.raw`
\begin{table}[t]
\centering
\caption{Out-of-distribution detection on the benchmark suite. Higher AUROC and lower
FPR95 are better. Best results in \textbf{bold}.}
\label{tab:main}
\begin{tabular}{lcc}
\toprule
Method & AUROC $\uparrow$ & FPR95 $\downarrow$ \\
\midrule
MSP baseline & 0.86 & 0.41 \\
Mahalanobis & 0.91 & 0.28 \\
\textbf{Fisher fusion (ours)} & \textbf{0.95} & \textbf{0.17} \\
\bottomrule
\end{tabular}
\end{table}`;
    return String.raw`
\section{Introduction}
Deep classifiers are trusted in safety-critical perception pipelines, yet they remain
overconfident on inputs drawn from outside the training distribution. Detecting such
out-of-distribution (OOD) inputs before they reach a downstream controller is therefore
a prerequisite for robust deployment~\cite{hendrycks2017baseline}. We study whether a
fusion of complementary feature statistics yields a calibrated, threshold-stable score.

\section{Related Work}
Post-hoc detectors attach a scoring rule to a frozen network. Maximum softmax probability
provides a simple baseline~\cite{hendrycks2017baseline}, temperature scaling with input
perturbation sharpens the separation~\cite{liang2018odin}, and class-conditional Gaussian
modelling in feature space gives a distance score~\cite{lee2018mahalanobis}. Standardised
benchmarks now make these comparisons reproducible~\cite{yang2024openood}.

\section{Method}
Let $f(\cdot)$ denote the penultimate feature map of a trained network. We combine a
density term and a gradient term into a single Fisher-weighted score
\begin{equation}
s(x) \;=\; \big(f(x) - \mu\big)^{\!\top} \Sigma^{-1} \big(f(x) - \mu\big)
        \;+\; \lambda \,\big\| \nabla_{x}\, \log p_\theta(x) \big\|_2^2 ,
\label{eq:score}
\end{equation}
where $\mu$ and $\Sigma$ are the in-distribution mean and covariance and $\lambda$ trades
off the two views. An input is flagged when $s(x)$ exceeds a validation-calibrated
threshold.

\section{Experiments}
We evaluate on the standard near- and far-OOD splits and report AUROC and FPR95.
Table~\ref{tab:main} summarises the headline numbers and Figure~\ref{fig:roc} shows the
operating curve. The fusion improves AUROC while reducing the false-positive rate at the
$95\%$ true-positive operating point.
` + fig + tab + String.raw`

\section{Discussion}
The gain is largest on near-OOD inputs, where the density term alone is weak but the
gradient term remains informative. The two views are complementary, and the
Fisher weighting keeps the combined score calibrated as the operating threshold moves.
A limitation is the cost of the covariance estimate, which we mitigate with a shrinkage
estimator.

\section{Conclusion}
We presented a Fisher-weighted fusion score for out-of-distribution detection that is
stable across thresholds and complementary to existing post-hoc detectors. Future work
will extend the analysis to 3D LiDAR perception and to streaming deployment.
`;
  }

  function files(mainTex) {
    return {
      active: 'main.tex',
      order: ['main.tex', 'references.bib'],
      folders: [],
      files: {
        'main.tex': { type: 'tex', content: mainTex },
        'references.bib': { type: 'bib', content: BIB }
      }
    };
  }

  var TITLE = 'Robust Out-of-Distribution Detection via Fisher Fusion';
  var ABSTRACT = 'We present a post-hoc out-of-distribution detector that fuses a feature-space density term with a gradient-norm term into a single Fisher-weighted score. The score is calibrated on validation data and remains stable across decision thresholds. On standard near- and far-OOD benchmarks it improves AUROC and lowers the false-positive rate at the 95\\% true-positive operating point, without retraining the backbone.';
  var KEYWORDS = ['out-of-distribution detection', 'uncertainty estimation', 'robust perception', 'deep learning', 'safety'];

  /* ----------------- per-family skeleton builders ----------------- */
  function ieeetran(mode) {
    var cls = mode === 'conference' ? 'conference' : 'journal';
    return files(String.raw`\documentclass[${cls},onecolumn,draftcls]{IEEEtran}
% Final IEEE layout is two-column; draftcls/onecolumn is review-friendly and reads aloud well.
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{cite}

\begin{document}
\title{${TITLE}}
\author{\IEEEauthorblockN{First Author and Second Author}
\IEEEauthorblockA{Department of Computer Science, Example University, City, Country\\
Email: first.author@example.edu}}
\maketitle

\begin{abstract}
${ABSTRACT}
\end{abstract}

\begin{IEEEkeywords}
${KEYWORDS.join(', ')}.
\end{IEEEkeywords}
` + body() + String.raw`
\bibliographystyle{IEEEtran}
\bibliography{references}
\end{document}
`);
  }

  function elsarticle() {
    return files(String.raw`\documentclass[preprint,review,12pt]{elsarticle}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}

\journal{Preprint submitted to Elsevier}

\begin{document}
\begin{frontmatter}
\title{${TITLE}}
\author[a]{First Author\corref{cor}}
\ead{first.author@example.edu}
\author[a]{Second Author}
\affiliation[a]{organization={Example University, Department of Computer Science},
  city={City}, country={Country}}
\cortext[cor]{Corresponding author.}

\begin{abstract}
${ABSTRACT}
\end{abstract}

\begin{keyword}
${KEYWORDS.join(' \\sep ')}
\end{keyword}
\end{frontmatter}
` + body() + String.raw`
\bibliographystyle{elsarticle-num}
\bibliography{references}
\end{document}
`);
  }

  function snjnl(refStyle) {
    return files(String.raw`\documentclass[${refStyle || 'sn-basic'}]{sn-jnl}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{amsmath,amssymb}

\begin{document}
\title{${TITLE}}
\author[1]{\fnm{First} \sur{Author}}\email{first.author@example.edu}
\author[1]{\fnm{Second} \sur{Author}}
\affil[1]{\orgdiv{Department of Computer Science}, \orgname{Example University},
  \city{City}, \country{Country}}

\abstract{${ABSTRACT}}
\keywords{${KEYWORDS.join(', ')}}

\maketitle
` + body() + String.raw`
\bibliographystyle{sn-basic}
\bibliography{references}
\end{document}
`);
  }

  function llncs() {
    return files(String.raw`\documentclass[runningheads]{llncs}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{amsmath,amssymb}

\begin{document}
\title{${TITLE}}
\titlerunning{Robust OOD Detection via Fisher Fusion}
\author{First Author\inst{1} \and Second Author\inst{1}}
\authorrunning{F. Author et al.}
\institute{Example University, City, Country \\ \email{first.author@example.edu}}
\maketitle

\begin{abstract}
${ABSTRACT}
\keywords{${KEYWORDS.join(' \\and ')}}
\end{abstract}
` + body() + String.raw`
\bibliographystyle{splncs04}
\bibliography{references}
\end{document}
`);
  }

  function mdpi(journalOpt) {
    // MDPI ships its class inside a Definitions/ bundle, so this skeleton will not
    // typeset in-browser until you add the official MDPI template files. The source,
    // structure and KPI checks are still correct; read-aloud works on the text.
    return files(String.raw`% !! MDPI: add the official template's Definitions/ folder (mdpi.cls, mdpi.bst, logos)
% from https://www.mdpi.com/authors/latex for the PDF to compile.
\documentclass[${journalOpt},article,submit,pdftex,moreauthors]{Definitions/mdpi}

\Title{${TITLE}}
\Author{First Author$^{1,}$* and Second Author$^{1}$}
\address{$^{1}$ \quad Example University, Department of Computer Science, City, Country}
\corres{Correspondence: first.author@example.edu}

\abstract{${ABSTRACT}}
\keyword{${KEYWORDS.join('; ')}}

\begin{document}
` + body() + String.raw`
\end{document}
`);
  }

  function acmart() {
    return files(String.raw`\documentclass[sigconf,review,anonymous]{acmart}
\usepackage{booktabs}
\settopmatter{printacmref=false}
\acmConference[Conf '26]{ACM Conference}{2026}{City, Country}

\begin{document}
\title{${TITLE}}
\author{First Author}
\affiliation{\institution{Example University}\city{City}\country{Country}}
\email{first.author@example.edu}

\begin{abstract}
${ABSTRACT}
\end{abstract}

\keywords{${KEYWORDS.join(', ')}}
\maketitle
` + body() + String.raw`
\bibliographystyle{ACM-Reference-Format}
\bibliography{references}
\end{document}
`);
  }

  function revtex(sub) {
    return files(String.raw`\documentclass[${sub || 'aps,prl'},preprint,superscriptaddress]{revtex4-2}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{amsmath,amssymb}

\begin{document}
\title{${TITLE}}
\author{First Author}
\author{Second Author}
\affiliation{Example University, Department of Physics, City, Country}

\begin{abstract}
${ABSTRACT}
\end{abstract}
\maketitle
` + body() + String.raw`
\bibliography{references}
\end{document}
`);
  }

  // ML-conference camera-ready styles (neurips_20xx.sty / cvpr.sty) are NOT on CTAN;
  // we base the skeleton on `article` and flag where to drop in the official .sty.
  function confStyle(note, twocol) {
    return files(String.raw`% !! Add the official ${note} style file to compile in the venue's exact layout.
\documentclass[${twocol ? 'twocolumn,' : ''}10pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{amsmath,amssymb}
\usepackage{natbib}

\title{${TITLE}}
\author{First Author \and Second Author \\ Example University}
\date{}

\begin{document}
\maketitle

\begin{abstract}
${ABSTRACT}
\end{abstract}

\noindent\textbf{Keywords:} ${KEYWORDS.join(', ')}.
` + body() + String.raw`
\bibliographystyle{plainnat}
\bibliography{references}
\end{document}
`);
  }

  function article(preprint) {
    return files(String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{amsmath,amssymb}
\usepackage{hyperref}

\title{${TITLE}}
\author{First Author \and Second Author}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
${ABSTRACT}
\end{abstract}

\noindent\textbf{Keywords:} ${KEYWORDS.join(', ')}.
` + body() + String.raw`
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`);
  }

  function blankFiles(ctx) {
    var t = (ctx && ctx.title) || 'Untitled';
    return {
      active: 'main.tex', order: ['main.tex'], folders: [],
      files: { 'main.tex': { type: 'tex', content: String.raw`\documentclass[11pt]{article}
\usepackage{amsmath}
\usepackage{graphicx}

\title{` + t + String.raw`}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
Start writing here. Press play in the toolbar to hear this sentence read aloud.
Click any sentence to set where reading begins.

\section{Background}
Add your content, equations, figures and tables. When you spot a mistake, pause,
fix it, and continue listening.

\end{document}
` } }
    };
  }

  /* ----------------- limit + journalMeta helpers ----------------- */
  var IMRAD = ['introduction', 'method', 'experiments', 'conclusion'];
  function lim(o) {
    o = o || {};
    return {
      columns: o.columns || 1,
      pageLimit: o.pageLimit != null ? o.pageLimit : null,     // null = no hard cap
      wordLimit: o.wordLimit != null ? o.wordLimit : null,
      abstractWords: o.abstractWords != null ? o.abstractWords : 250,
      keywordsMax: o.keywordsMax != null ? o.keywordsMax : null,
      refStyle: o.refStyle || '',
      requiredSections: o.requiredSections || IMRAD
    };
  }
  function jm(o) {
    // o: {if, ifYear, citeScore, sjr, quartile, hIndex, accept, apc, oa, indexing, source, confidence}
    return {
      impactFactor: o.if || null, impactFactorYear: o.ifYear || '2024 (JCR)',
      citeScore: o.citeScore || null, sjr: o.sjr || null, quartile: o.quartile || null,
      hIndex: o.hIndex || null, acceptanceRate: o.accept || null, apc: o.apc || null,
      oaModel: o.oa || null, indexing: o.indexing || null,
      source: o.source || 'JCR 2024 / Scopus / Scimago — verify before relying',
      confidence: o.confidence || 'medium'
    };
  }

  /* ----------------- the registry ----------------- */
  var T = [
    // --- Start ---
    { id: 'blank', name: 'Blank document', publisher: 'LaTeX', group: 'Start', documentClass: 'article',
      indexing: '', description: 'A minimal article skeleton to start from scratch.',
      journalMeta: null, limits: null, build: blankFiles },
    { id: 'sample', name: 'Sample paper (demo)', publisher: 'Aloud', group: 'Start', documentClass: 'article',
      indexing: '', description: 'The guided demo with figures, math and a bibliography.',
      journalMeta: null, limits: lim({}), build: function () { var s = window.PR_SAMPLE; return { active: s.active, order: s.order.slice(), folders: (s.folders || []).slice(), files: JSON.parse(JSON.stringify(s.files)) }; } },
    { id: 'generic-arxiv', name: 'arXiv preprint', publisher: 'Generic', group: 'Start', documentClass: 'article',
      indexing: 'Preprint (not indexed; carrier for Scopus-indexed camera-ready)', description: 'Single-column article preprint for arXiv or a thesis chapter.',
      journalMeta: null, limits: lim({ abstractWords: 250 }), build: function () { return article(true); } },

    // --- IEEE (IEEEtran) ---
    { id: 'ieee-access', name: 'IEEE Access', publisher: 'IEEE', group: 'IEEE', documentClass: 'IEEEtran',
      indexing: 'WoS SCIE + Scopus + DOAJ (Gold OA)', description: 'IEEE Access mega-journal (Gold OA, no hard page cap).',
      journalMeta: jm({ if: '3.6', citeScore: '9.0', sjr: '0.96', quartile: 'Q2 JCR / Q1 CiteScore (CS, general)', hIndex: '~270', accept: '~25–30%', apc: 'USD 1,995', oa: 'Gold OA (mandatory APC)', indexing: 'WoS SCIE, Scopus, DOAJ', source: 'JCR 2024 / Scopus 2024 / journal site', confidence: 'high' }),
      limits: lim({ columns: 2, abstractWords: 250, refStyle: 'IEEEtran' }), build: function () { return ieeetran('journal'); } },
    { id: 'ieee-tpami', name: 'IEEE TPAMI', publisher: 'IEEE', group: 'IEEE', documentClass: 'IEEEtran',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'IEEE Trans. Pattern Analysis & Machine Intelligence — flagship CV/AI journal.',
      journalMeta: jm({ if: '18.6', citeScore: '35.0', sjr: '3.9', quartile: 'Q1 (CS, Artificial Intelligence)', hIndex: '~435', accept: '~20–25%', apc: 'Subscription; optional OA', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024 / Scopus 2024 (computer.org; 21.x IF figures are stale/predictive)', confidence: 'high' }),
      limits: lim({ columns: 2, abstractWords: 200, refStyle: 'IEEEtran' }), build: function () { return ieeetran('journal'); } },
    { id: 'ieee-tip', name: 'IEEE TIP', publisher: 'IEEE', group: 'IEEE', documentClass: 'IEEEtran',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'IEEE Trans. Image Processing.',
      journalMeta: jm({ if: '13.7', citeScore: '16.4', sjr: '2.50', quartile: 'Q1 (CS, AI; EE)', hIndex: '346', accept: '~20–25%', apc: 'Subscription; optional OA', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024', confidence: 'high' }),
      limits: lim({ columns: 2, abstractWords: 200, refStyle: 'IEEEtran' }), build: function () { return ieeetran('journal'); } },
    { id: 'ieee-tnnls', name: 'IEEE TNNLS', publisher: 'IEEE', group: 'IEEE', documentClass: 'IEEEtran',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'IEEE Trans. Neural Networks & Learning Systems.',
      journalMeta: jm({ if: '8.9', citeScore: '20.8', sjr: '3.69', quartile: 'Q1 (CS, Artificial Intelligence)', hIndex: '269', accept: '~20–25%', apc: 'Subscription; optional OA', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024 (ooir.org; 13.x figures are predictive)', confidence: 'high' }),
      limits: lim({ columns: 2, abstractWords: 200, refStyle: 'IEEEtran' }), build: function () { return ieeetran('journal'); } },
    { id: 'ieee-conf', name: 'IEEE conference', publisher: 'IEEE', group: 'IEEE', documentClass: 'IEEEtran',
      indexing: 'WoS CPCI + Scopus (proceedings)', description: 'Generic IEEE conference paper (two-column, page limit set by the CfP).',
      journalMeta: null, limits: lim({ columns: 2, pageLimit: 8, abstractWords: 200, refStyle: 'IEEEtran' }), build: function () { return ieeetran('conference'); } },

    // --- Elsevier (elsarticle) ---
    { id: 'elsevier-patternrec', name: 'Pattern Recognition', publisher: 'Elsevier', group: 'Elsevier', documentClass: 'elsarticle',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'Pattern Recognition — top CV/AI journal.',
      journalMeta: jm({ if: '7.6', citeScore: '15.5', sjr: '2.058', quartile: 'Q1 (CS, AI; Engineering)', hIndex: '257', accept: '~15–20%', apc: 'USD 2,800 (optional OA)', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024 (9.x aggregator figures mix cycles)', confidence: 'high' }),
      limits: lim({ columns: 1, abstractWords: 200, keywordsMax: 6, refStyle: 'elsarticle-num' }), build: elsarticle },
    { id: 'elsevier-neurocomputing', name: 'Neurocomputing', publisher: 'Elsevier', group: 'Elsevier', documentClass: 'elsarticle',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'Neurocomputing.',
      journalMeta: jm({ if: '6.5', citeScore: '10.8', sjr: '1.471', quartile: 'Q1 (CS, Artificial Intelligence)', hIndex: '216', accept: '~20–30%', apc: 'USD 2,930 (optional OA)', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024 / Scopus 2024 (8.x aggregator figure is predictive)', confidence: 'high' }),
      limits: lim({ columns: 1, abstractWords: 200, keywordsMax: 6, refStyle: 'elsarticle-num' }), build: elsarticle },
    { id: 'elsevier-eswa', name: 'Expert Systems with Applications', publisher: 'Elsevier', group: 'Elsevier', documentClass: 'elsarticle',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'Expert Systems with Applications.',
      journalMeta: jm({ if: '~7.5', citeScore: '12.2', sjr: '1.854', quartile: 'Q1 (CS, AI; Engineering; OR)', hIndex: '290', accept: '~15–20%', apc: 'USD 3,490 (optional OA)', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024 (10.x aggregator figure mixes cycles)', confidence: 'medium' }),
      limits: lim({ columns: 1, abstractWords: 200, keywordsMax: 6, refStyle: 'elsarticle-num' }), build: elsarticle },
    { id: 'elsevier-infofusion', name: 'Information Fusion', publisher: 'Elsevier', group: 'Elsevier', documentClass: 'elsarticle',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'Information Fusion — one of the highest-IF AI journals.',
      journalMeta: jm({ if: '15.5', citeScore: '28.4', sjr: '4.128', quartile: 'Q1 (CS, AI / Information Systems)', hIndex: '179', accept: '~10–15%', apc: 'USD 4,500 (optional OA)', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024 (journalmetrics.org; 22.x is Scopus impact, not JIF)', confidence: 'high' }),
      limits: lim({ columns: 1, abstractWords: 200, keywordsMax: 6, refStyle: 'elsarticle-num' }), build: elsarticle },

    // --- Springer ---
    { id: 'springer-ijcv', name: 'Int. J. of Computer Vision (IJCV)', publisher: 'Springer Nature', group: 'Springer', documentClass: 'sn-jnl',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'IJCV — flagship computer-vision journal (sn-jnl).',
      journalMeta: jm({ if: '9.3', citeScore: '16.8', sjr: '4.0', quartile: 'Q1 (CS, AI / Computer Vision)', hIndex: '232', accept: '~20–30%', apc: 'Optional OA ~USD 4,090', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024', confidence: 'high' }),
      limits: lim({ columns: 1, abstractWords: 250, refStyle: 'sn-basic' }), build: function () { return snjnl('sn-basic'); } },
    { id: 'springer-ml', name: 'Machine Learning (Springer)', publisher: 'Springer Nature', group: 'Springer', documentClass: 'sn-jnl',
      indexing: 'WoS SCIE + Scopus (hybrid)', description: 'Machine Learning journal (sn-jnl).',
      journalMeta: jm({ if: '2.9 (5-yr ~6.6)', citeScore: '~7.2', sjr: '1.147', quartile: 'Q1 by SJR (CS, AI)', hIndex: '175', accept: '~20–30%', apc: 'Optional OA ~USD 3,390', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024 / Scopus 2024', confidence: 'medium' }),
      limits: lim({ columns: 1, abstractWords: 250, refStyle: 'sn-basic' }), build: function () { return snjnl('sn-basic'); } },
    { id: 'springer-lncs', name: 'LNCS / ECCV proceedings', publisher: 'Springer Nature', group: 'Springer', documentClass: 'llncs',
      indexing: 'WoS CPCI + Scopus (proceedings)', description: 'Lecture Notes in Computer Science — ECCV, MICCAI, ECML-PKDD, etc.',
      journalMeta: jm({ if: 'n/a (proceedings)', ifYear: 'n/a', citeScore: 'series-level', sjr: '~0.6 (LNCS series)', quartile: 'Q1/Q2 by SJR (LNCS series)', hIndex: 'series-level', accept: '~25–30%', apc: 'Registration; optional OA', oa: 'Subscription / optional OA', indexing: 'Scopus (LNCS proceedings); not in JCR', source: 'Scimago (series-level); approximate', confidence: 'low' }),
      limits: lim({ columns: 1, pageLimit: 14, abstractWords: 250, refStyle: 'splncs04' }), build: llncs },

    // --- MDPI ---
    { id: 'mdpi-sensors', name: 'Sensors (MDPI)', publisher: 'MDPI', group: 'MDPI', documentClass: 'mdpi',
      indexing: 'WoS SCIE + Scopus + PMC (Gold OA)', description: 'Sensors — central to the sensors/applied-ML segment. Needs the MDPI bundle to compile.',
      journalMeta: jm({ if: '3.5', citeScore: '8.2', sjr: '0.764', quartile: 'Q2 JCR / Q1 CiteScore (Instrumentation)', hIndex: '273', accept: '~52–56%', apc: 'CHF 2,600', oa: 'Gold OA (mandatory APC)', indexing: 'WoS SCIE, Scopus, PMC, DOAJ', source: 'JCR 2024 / Scopus 2024', confidence: 'high' }),
      limits: lim({ columns: 1, abstractWords: 200, refStyle: 'mdpi', requiredSections: ['introduction', 'materials and methods', 'results', 'discussion', 'conclusions'] }), build: function () { return mdpi('sensors'); } },
    { id: 'mdpi-remotesensing', name: 'Remote Sensing (MDPI)', publisher: 'MDPI', group: 'MDPI', documentClass: 'mdpi',
      indexing: 'WoS SCIE + Scopus (Gold OA)', description: 'Remote Sensing. Needs the MDPI bundle to compile.',
      journalMeta: jm({ if: '4.1', citeScore: '8.3', sjr: '1.019', quartile: 'Q1 (Geosciences / Imaging Science)', hIndex: '217', accept: '~40–45%', apc: 'CHF 2,700', oa: 'Gold OA (mandatory APC)', indexing: 'WoS SCIE, Scopus, DOAJ', source: 'JCR 2024 / Scopus 2024', confidence: 'high' }),
      limits: lim({ columns: 1, abstractWords: 200, refStyle: 'mdpi', requiredSections: ['introduction', 'materials and methods', 'results', 'discussion', 'conclusions'] }), build: function () { return mdpi('remotesensing'); } },

    // --- ACM ---
    { id: 'acm-conf', name: 'ACM conference (sigconf)', publisher: 'ACM', group: 'ACM', documentClass: 'acmart',
      indexing: 'WoS CPCI + Scopus (proceedings)', description: 'ACM proceedings (KDD, MM, SIGIR, WWW). Two-column sigconf.',
      journalMeta: null, limits: lim({ columns: 2, pageLimit: 9, abstractWords: 250, refStyle: 'ACM-Reference-Format' }), build: acmart },

    // --- APS / AIP ---
    { id: 'aps-prl', name: 'Physical Review Letters (REVTeX)', publisher: 'APS', group: 'APS / AIP', documentClass: 'revtex4-2',
      indexing: 'WoS SCIE + Scopus', description: 'APS Physical Review (REVTeX 4.2). PRL enforces a ~3750-word / 4-page limit.',
      journalMeta: jm({ if: '8.1', citeScore: '15.0', sjr: '3.6', quartile: 'Q1 (Physics, multidisciplinary)', hIndex: '~800', accept: '~25–30%', apc: 'Hybrid / optional OA', oa: 'Hybrid', indexing: 'WoS SCIE, Scopus', source: 'JCR 2024 — verify', confidence: 'low' }),
      limits: lim({ columns: 2, pageLimit: 4, wordLimit: 3750, abstractWords: 250, refStyle: 'apsrev4-2' }), build: function () { return revtex('aps,prl'); } },

    // --- ML conferences (article + venue .sty) ---
    { id: 'conf-neurips', name: 'NeurIPS', publisher: 'NeurIPS', group: 'ML conferences', documentClass: 'article + neurips.sty',
      indexing: 'Scopus (proceedings); not in JCR', description: 'NeurIPS camera-ready — 9 content pages, references/appendix uncapped. Add neurips_20xx.sty.',
      journalMeta: jm({ if: 'n/a (proceedings)', ifYear: 'n/a', citeScore: 'very high (Scopus)', sjr: '1.88', quartile: 'Q1 by SJR (CS, AI)', hIndex: '415', accept: '~25–26%', apc: 'Registration; OA proceedings', oa: 'Open access proceedings', indexing: 'Scopus (proceedings); not in JCR', source: 'Scimago / NeurIPS CfP', confidence: 'medium' }),
      limits: lim({ columns: 1, pageLimit: 9, abstractWords: 250 }), build: function () { return confStyle('NeurIPS (neurips_20xx.sty)', false); } },
    { id: 'conf-cvpr', name: 'CVPR / ICCV', publisher: 'IEEE/CVF', group: 'ML conferences', documentClass: 'article + cvpr.sty',
      indexing: 'Scopus (proceedings); not in JCR', description: 'CVPR/ICCV camera-ready — 8 pages excluding references. Add the official cvpr.sty.',
      journalMeta: jm({ if: 'n/a (proceedings)', ifYear: 'n/a', citeScore: 'very high (Scopus)', sjr: '4.7 (CVPR)', quartile: 'Q1 by SJR (Computer Vision)', hIndex: '601', accept: '~23.6% (CVPR 2024)', apc: 'Registration; CVF open access', oa: 'Open access proceedings (CVF)', indexing: 'Scopus (proceedings); not in JCR', source: 'Scimago / CVPR author guidelines', confidence: 'medium' }),
      limits: lim({ columns: 2, pageLimit: 8, abstractWords: 250 }), build: function () { return confStyle('CVPR/ICCV (cvpr.sty)', true); } }
  ];

  function byId(id) { for (var i = 0; i < T.length; i++) if (T[i].id === id) return T[i]; return null; }
  // Resolve a template to a fresh file set (clones the build output). ctx may carry { title }.
  function filesFor(id, ctx) { var t = byId(id); if (!t) return null; try { return t.build(ctx); } catch (e) { return null; } }
  // Group entries by publisher group, preserving declaration order.
  function groups() {
    var order = [], map = {};
    T.forEach(function (t) { if (!map[t.group]) { map[t.group] = []; order.push(t.group); } map[t.group].push(t); });
    return order.map(function (g) { return { group: g, items: map[g] }; });
  }

  return { all: T, byId: byId, filesFor: filesFor, groups: groups };
})();
