//@include "json2.js"
//@include "captions.jsx"
//@include "lab.jsx"

/* ExtendScript host of the eve-cut panel.
 *
 * ES3 only: no let/const, no arrow functions, no JSON in the engine (json2.js provides it).
 * Every function takes a single JSON string and returns {"ok":true,"data":...} or
 * {"ok":false,"error":"..."}; an unhandled error would send an empty response back to the panel.
 */

function eveOk(data) {
  return JSON.stringify({ ok: true, data: data });
}

function eveErr(e) {
  return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
}

function eveArgs(argJson) {
  if (!argJson) return {};
  try {
    return JSON.parse(argJson);
  } catch (e) {
    return {};
  }
}

/* Status bar of the panel: app version, project path and active sequence. */
function evePing(argJson) {
  try {
    var project = app.project;
    var sequence = project ? project.activeSequence : null;
    return eveOk({
      appVersion: app.version,
      projectPath: project ? project.path : null,
      sequence: sequence ? { name: sequence.name, id: sequence.sequenceID } : null
    });
  } catch (e) {
    return eveErr(e);
  }
}
