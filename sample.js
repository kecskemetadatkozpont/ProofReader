/* Seed project for Aloud */
window.PR_SAMPLE = (function () {
  var tex = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Attention-Guided Sentence Segmentation\\ for Robust Text-to-Speech Proofreading}
\author{A.~Researcher \and B.~Collaborator}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
We present \emph{Aloud}, a system that reads a scientific manuscript aloud while
highlighting the sentence currently being spoken. Authors can pause at any point,
correct the the text in place, and resume listening from the sentence they just edited.
Our experiments show that audible proofreading helps writers catch agreement errors
and awkward phrasing that silent reading often misses.
\end{abstract}

\section{Introduction}
Proofreading a long document is hard because the eye tends to skim familiar text.
Reading the manuscript out loud is a classic remedy, but doing so manually is slow.
We argue that a tool which speaks each sentence, and shows exactly which sentence is
being read, lets authors recieve immediate feedback on rhythm and grammar.
The key challenge is mapping the spoken stream back to the source so that an edit can
be made without losing one's place.

\section{Method}
\subsection{Sentence segmentation}
We first strip the \LaTeX{} markup to obtain a clean reading stream.
Commands such as \texttt{\textbackslash cite} and math are removed from the audio,
while their positions in the source are preserved.
Sentence boundaries are detected with the rule below, where $b_i$ marks a boundary:
\begin{equation}
b_i = \mathbb{1}\!\left[\, t_i \in \{.,!,?\} \;\wedge\; \text{depth}(i)=0 \,\right].
\end{equation}
Here $\text{depth}(i)$ counts unmatched braces and math delimiters, so punctuation
inside an equation never splits a sentence.

\subsection{Synchronised highlighting}
Each spoken sentence is linked to a character range in the source and to a span in
the rendered preview. When playback advances, both views highlight in lockstep.
The benefits of this design are:
\begin{itemize}
  \item the author always sees where the voice is;
  \item an edit can begin with a single click in the editor;
  \item playback resume from the corrected sentence, not the start.
\end{itemize}

\section{Results}
We evaluated the tool on a corpus of draft papers.
Figure~\ref{fig:acc} shows that audible review surfaced more agreement errors than a
silent pass over the same time budget.
\begin{figure}
\centering
\includegraphics[width=0.7\textwidth]{figure-results.png}
\caption{Errors caught per minute. The proposed audible workflow (blue) consistently
recovers more issues than the silent baseline (amber) as review time grows.}
\end{figure}

\noindent A short summary of the headline numbers is given in Table~\ref{tab:main}.
\begin{table}
\centering
\begin{tabular}{lcc}
Method & Errors/min & Recall \\
Silent baseline & 1.8 & 0.61 \\
Aloud & 3.4 & 0.88 \\
\end{tabular}
\caption{Main results on the draft-paper corpus. Higher is better for both metrics.}
\end{table}

\section{Conclusion}
Listening to a manuscript is a simple but powerful way to find mistakes, and the results
is encouraging. By keeping the spoken position tied to the editable source, Aloud
turns proofreading into a comfortable, continuous loop of listen, fix, and continue.

\end{document}
`;

  var bib = String.raw`@article{proofread2026,
  title   = {Attention-Guided Sentence Segmentation for TTS Proofreading},
  author  = {Researcher, A. and Collaborator, B.},
  journal = {Proceedings of Nowhere},
  year    = {2026}
}
`;

  return {
    active: 'main.tex',
    folders: ['images'],
    order: ['main.tex', 'references.bib', 'images/figure-results.png'],
    files: {
      'main.tex': { type: 'tex', content: tex },
      'references.bib': { type: 'bib', content: bib },
      'images/figure-results.png': { type: 'image', src: 'assets/figure-results.png' }
    }
  };
})();
