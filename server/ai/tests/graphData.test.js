/**
 * CaseMind AI Module - Graph Data Builder Unit Tests (tests/graphData.test.js)
 *
 * Tests buildGraph(report) on a saved report and edge cases:
 * - Nodes: [{ id, type, label }]
 * - Edges: [{ from, to, kind }]
 * - Kinds: 'connection' | 'contradiction' | 'supports' | 'conflicts'
 * - Derived strictly from evidenceIds and hypothesis fields without LLM calls.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildGraph } = require('../graphData');

function runGraphDataTests() {
  console.log('--- Testing graphData.js (buildGraph pure function) ---\n');

  // -------------------------------------------------------------------------
  // Test 1: Test buildGraph on saved report fixture (sample_report.json)
  // -------------------------------------------------------------------------
  console.log('[Test 1] Testing buildGraph on saved report fixture...');
  const fixturePath = path.join(__dirname, 'fixtures', 'sample_report.json');
  const savedReport = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const graph = buildGraph(savedReport);

  assert.ok(graph, 'Graph must be returned');
  assert.ok(Array.isArray(graph.nodes), 'graph.nodes must be an array');
  assert.ok(Array.isArray(graph.edges), 'graph.edges must be an array');

  // Verify node structure
  for (const node of graph.nodes) {
    assert.ok(node.id, `Node must have an id: ${JSON.stringify(node)}`);
    assert.ok(
      node.type === 'evidence' || node.type === 'hypothesis',
      `Node type must be 'evidence' or 'hypothesis', got: ${node.type}`
    );
    assert.ok(typeof node.label === 'string' && node.label.length > 0, `Node label must be non-empty string: ${JSON.stringify(node)}`);
  }

  // Check expected nodes
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  assert.ok(nodeIds.has('EV-01'), 'Must include EV-01 node');
  assert.ok(nodeIds.has('EV-02'), 'Must include EV-02 node');
  assert.ok(nodeIds.has('EV-03'), 'Must include EV-03 node');
  assert.ok(nodeIds.has('HYP-01'), 'Must include HYP-01 node');
  assert.ok(nodeIds.has('HYP-02'), 'Must include HYP-02 node');

  const evNode1 = graph.nodes.find((n) => n.id === 'EV-01');
  assert.strictEqual(evNode1.type, 'evidence');
  assert.strictEqual(evNode1.label, 'EV-01');

  const hypNode1 = graph.nodes.find((n) => n.id === 'HYP-01');
  assert.strictEqual(hypNode1.type, 'hypothesis');
  assert.strictEqual(hypNode1.label, 'Authorized badge holder accessed the vault at 01:15 AM.');

  console.log(`  ✓ Nodes verified (${graph.nodes.length} nodes):`);
  graph.nodes.forEach((n) => console.log(`    • [${n.type.toUpperCase()}] id=${n.id}, label="${n.label.slice(0, 50)}"`));

  // Verify edge structure and kinds
  const allowedKinds = new Set(['connection', 'contradiction', 'supports', 'conflicts']);
  const kindsFound = new Set();

  for (const edge of graph.edges) {
    assert.ok(edge.from, `Edge must have 'from': ${JSON.stringify(edge)}`);
    assert.ok(edge.to, `Edge must have 'to': ${JSON.stringify(edge)}`);
    assert.ok(allowedKinds.has(edge.kind), `Edge kind must be one of ${Array.from(allowedKinds).join('|')}, got: ${edge.kind}`);
    kindsFound.add(edge.kind);
  }

  // Confirm all 4 kinds are present in the saved report
  assert.ok(kindsFound.has('connection'), "Saved report graph must contain 'connection' edges");
  assert.ok(kindsFound.has('contradiction'), "Saved report graph must contain 'contradiction' edges");
  assert.ok(kindsFound.has('supports'), "Saved report graph must contain 'supports' edges");
  assert.ok(kindsFound.has('conflicts'), "Saved report graph must contain 'conflicts' edges");

  console.log(`\n  ✓ Edges verified (${graph.edges.length} edges, all 4 kinds present):`);
  graph.edges.forEach((e) => console.log(`    • ${e.from} --[${e.kind}]--> ${e.to}`));

  // Verify specific edges
  const hasConnection = graph.edges.some(
    (e) => e.kind === 'connection' && ((e.from === 'EV-01' && e.to === 'EV-02') || (e.from === 'EV-02' && e.to === 'EV-01'))
  );
  assert.ok(hasConnection, 'Must have connection between EV-01 and EV-02');

  const hasContradiction1 = graph.edges.some(
    (e) => e.kind === 'contradiction' && ((e.from === 'EV-01' && e.to === 'EV-03') || (e.from === 'EV-03' && e.to === 'EV-01'))
  );
  assert.ok(hasContradiction1, 'Must have contradiction between EV-01 and EV-03');

  const hasSupports = graph.edges.some(
    (e) => e.kind === 'supports' && e.from === 'EV-01' && e.to === 'HYP-01'
  );
  assert.ok(hasSupports, 'Must have supports edge from EV-01 to HYP-01');

  const hasConflicts = graph.edges.some(
    (e) => e.kind === 'conflicts' && e.from === 'EV-03' && e.to === 'HYP-01'
  );
  assert.ok(hasConflicts, 'Must have conflicts edge from EV-03 to HYP-01');

  // Verify no duplicate edges
  const edgeKeys = graph.edges.map((e) => `${e.kind}:${e.from}->${e.to}`);
  const uniqueKeys = new Set(edgeKeys);
  assert.strictEqual(edgeKeys.length, uniqueKeys.size, 'Edges must be deduplicated');
  console.log('  ✓ No duplicate edges exist in graph representation');

  // -------------------------------------------------------------------------
  // Test 2: Edge cases: empty/null report and disconnected nodes
  // -------------------------------------------------------------------------
  console.log('\n[Test 2] Testing edge cases (null, empty report, isolated nodes)...');

  assert.deepStrictEqual(buildGraph(null), { nodes: [], edges: [] });
  assert.deepStrictEqual(buildGraph(undefined), { nodes: [], edges: [] });
  assert.deepStrictEqual(buildGraph({}), { nodes: [], edges: [] });
  console.log('  ✓ Null and empty inputs return empty graph gracefully');

  // Report with isolated knownFact
  const isolatedReport = {
    knownFacts: [{ statement: 'Fact', evidenceIds: ['EV-99'] }],
    hypotheses: [{ hypothesisId: 'HYP-99', description: 'Standalone theory', supportingEvidenceIds: [], conflictingEvidenceIds: [] }],
  };
  const isolatedGraph = buildGraph(isolatedReport);
  assert.strictEqual(isolatedGraph.nodes.length, 2);
  assert.strictEqual(isolatedGraph.edges.length, 0);
  assert.strictEqual(isolatedGraph.nodes[0].id, 'HYP-99');
  assert.strictEqual(isolatedGraph.nodes[1].id, 'EV-99');
  console.log('  ✓ Isolated evidence and hypothesis nodes generated with 0 edges');

  // Report with flat contradiction evidenceIds
  const flatContradictionReport = {
    contradictions: [{ evidenceIds: ['EV-10', 'EV-20'], explanation: 'Flat conflict' }],
  };
  const flatGraph = buildGraph(flatContradictionReport);
  assert.strictEqual(flatGraph.edges.length, 1);
  assert.strictEqual(flatGraph.edges[0].kind, 'contradiction');
  console.log('  ✓ Flat contradiction evidenceIds correctly mapped');

  console.log('\n🎉 All graphData.js tests PASSED (2/2 suites)!');
}

if (require.main === module) {
  runGraphDataTests();
}

module.exports = { runGraphDataTests };
