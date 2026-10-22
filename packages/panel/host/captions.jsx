/* Captions of the eve-cut panel (F1).
 *
 * ES3 only, like index.jsx: every function takes one JSON string and returns
 * {"ok":true,"data":...} or {"ok":false,"error":"..."}.
 */

/* Export the first caption track (C1) of the active sequence as an .srt (P1).
 * exportAsMediaDirect renders a WAV with the eve-cut-legendas.epr preset and Premiere writes the
 * sidecar <wav>.srt next to it. It says "No Error" even when no .srt comes out (no caption track),
 * so the panel waits for the file itself. The output folder must exist: the call does not create it. */
function eveExportCaptionsSrt(argJson) {
  try {
    var arg = eveArgs(argJson);
    var project = app.project;
    var seq = project ? project.activeSequence : null;
    if (!seq) throw new Error('Abra um projeto e uma sequência no Premiere.');
    if (!arg.eprPath || !new File(arg.eprPath).exists) {
      throw new Error('Não achei o preset de exportação das legendas (' + arg.eprPath + '). Reinstale o painel.');
    }
    if (!arg.outPath) throw new Error('Caminho de saída vazio.');

    var folder = new File(arg.outPath).parent;
    if (folder && !folder.exists) folder.create();

    var started = new Date().getTime();
    var result = seq.exportAsMediaDirect(arg.outPath, arg.eprPath, 0);
    return eveOk({
      result: String(result),
      sequence: seq.name,
      durationMs: new Date().getTime() - started
    });
  } catch (e) {
    return eveErr(e);
  }
}
