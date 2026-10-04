import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadBracesModules, localDepthLimit } from "../scripts/check-braces-security.mjs";

// Optional owned temporary micromatch copy for demonstrating baseline failure.
// The separately executable pinned-source gate never accepts this override.
const { braces, micromatch, bracesPath, bracesRequire } = loadBracesModules(
  process.env.BRACES_SECURITY_TEST_MICROMATCH,
);
const rejectsDepth = (run) => assert.throws(run,
  (error) => error instanceof SyntaxError && /Braces nesting depth exceeds local limit \(64\)/.test(error.message));
const nest = (depth, open = "{", close = "}", inner = "x") => open.repeat(depth) + inner + close.repeat(depth);
const text = (value) => ({ type: "text", value });

// No recursive fixture builders or customer data. Parent/prev links mirror
// normal parser backlinks and must not be mistaken for child cycles.
function externalAst(depth) {
  const root = { type: "root", nodes: [] };
  let parent = root;
  for (let i = 0; i < depth; i++) {
    const node = { type: "paren", parent, nodes: [text("(")] };
    parent.nodes.push(node);
    if (parent.type === "paren") parent.nodes.push(text(")"));
    parent = node;
  }
  parent.nodes.push(text("x"));
  if (parent.type === "paren") parent.nodes.push(text(")"));
  return root;
}

const stringRoutes = {
  parse: (input) => braces.parse(input),
  compile: (input) => braces.compile(input),
  expand: (input) => braces.expand(input),
  stringify: (input) => braces.stringify(input),
  create: (input) => braces.create(input),
  "main compile": (input) => braces(["safe", input]),
  "main expand": (input) => braces(["safe", input], { expand: true }),
  "micromatch.parse": (input) => micromatch.parse(input),
  "micromatch.braces": (input) => micromatch.braces(input),
  "micromatch.braceExpand": (input) => micromatch.braceExpand(input),
};

for (const [name, route] of Object.entries(stringRoutes)) {
  test(`${name} rejects deeply nested braces below the original character limit`, () => {
    const input = nest(4999);
    assert.equal(input.length, 9999);
    rejectsDepth(() => route(input));
  });
}

for (const [name, route] of Object.entries(stringRoutes).filter(([name]) =>
  !["micromatch.braces", "micromatch.braceExpand"].includes(name))) {
  for (const input of [nest(4999, "(", ")"), "{".repeat(65), "(".repeat(65),
    "{(".repeat(33) + "x" + ")}".repeat(33)]) {
    test(`${name} rejects combined, parenthesis and unclosed nesting: ${input.slice(0, 4)}/${input.length}`, () => {
      rejectsDepth(() => route(input));
    });
  }
}

for (const name of ["compile", "expand", "stringify"]) {
  test(`${name} rejects deeply nested externally supplied ASTs`, () => {
    rejectsDepth(() => braces[name](externalAst(9999)));
    rejectsDepth(() => bracesRequire(`./lib/${name}`)(externalAst(9999)));
  });
  test(`${name} rejects child cycles without rejecting parsed backlinks`, () => {
    const ast = { type: "root", nodes: [] };
    ast.nodes.push(ast);
    assert.throws(() => braces[name](ast), { name: "SyntaxError", message: "Cyclic braces AST is not supported" });
    const parsed = braces.parse("a/{b,{c,d}}/e");
    assert.equal(parsed.nodes[2].parent, parsed);
    assert.doesNotThrow(() => braces[name](parsed));
  });
  test(`${name} bounds traversal of shared external DAGs`, () => {
    let node = text("x");
    for (let i = 0; i < 15; i++) node = { type: "root", nodes: [node, node] };
    assert.throws(() => braces[name](node), /AST exceeds local node visit limit/);
  });
}

test("expand rejects cyclic external parent chains promptly", () => {
  // Isolate this possible infinite-loop regression so the test itself cannot
  // hang the suite when run against unpatched upstream as a negative control.
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict');
    const braces = require(${JSON.stringify(bracesPath)});
    const root = { type: 'root', nodes: [] };
    const paren = { type: 'paren', nodes: [{ type: 'text', value: 'x' }] };
    paren.parent = paren; root.nodes.push(paren);
    assert.throws(() => braces.expand(root), { name: 'SyntaxError' });
  `], { encoding: "utf8", timeout: 2500 });
  assert.equal(result.error, undefined, "Parent cycle must throw before the child timeout");
  assert.equal(result.status, 0, result.stderr);
});

for (const cyclic of [false, true]) {
  test(`expand bounds arrays supplied through external parent queues, cycle=${cyclic}`, () => {
    let queue = ["x"];
    if (cyclic) queue.push(queue);
    else for (let i = 0; i < 4999; i++) queue = [queue];
    const foreignRoot = { type: "root", queue: [queue] };
    const ast = { type: "root", nodes: [{ type: "paren", parent: foreignRoot, nodes: [text("y")] }] };
    rejectsDepth(() => braces.expand(ast));
  });
}

test("the fixed nesting ceiling cannot be raised or disabled by caller options", () => {
  for (const options of [{ maxDepth: Infinity }, { maxDepth: false }, { maxDepth: 10000 },
    { rangeLimit: false, maxLength: Infinity }]) rejectsDepth(() => braces.compile(nest(65), options));
});

test("exactly 64 combined blocks remain supported and level 65 is rejected", () => {
  for (const [open, close] of [["{", "}"], ["(", ")"]]) {
    const input = nest(localDepthLimit, open, close);
    assert.equal(braces.stringify(input), input);
    assert.equal(braces.compile(input), input);
    assert.deepEqual(braces.expand(input), [input]);
    rejectsDepth(() => braces.parse(nest(localDepthLimit + 1, open, close)));
  }
  for (const name of ["compile", "expand", "stringify"]) {
    const result = braces[name](externalAst(64));
    assert.deepEqual(result, name === "expand" ? [nest(64, "(", ")")] : nest(64, "(", ")"));
    rejectsDepth(() => braces[name](externalAst(65)));
  }
});

const expansions = [
  ["a/{b,{c,d}}/e", ["a/b/e", "a/c/e", "a/d/e"]],
  ["file-{01..03}.js", ["file-01.js", "file-02.js", "file-03.js"]],
  ["{a..e..2}", ["a", "c", "e"]],
  ["{3..1}", ["3", "2", "1"]],
  ["{a,b}{1,2}", ["a1", "a2", "b1", "b2"]],
  ["x{a,a,b}", ["xa", "xa", "xb"]],
  ["a/(b|c)/{d,e}", ["a/(b|c)/d", "a/(b|c)/e"]],
  ["a/@(b|c)/{d,e}", ["a/@(b|c)/d", "a/@(b|c)/e"]],
  ["a/{b", ["a/{b"]],
  ["a/(b", ["a/(b"]],
  ["a/\\{b,c\\}", ["a/{b,c}"]],
  ["a/${b,c}", ["a/${b,c}"]],
];
for (const [input, expected] of expansions) {
  test(`ordinary expansion remains compatible: ${input}`, () => {
    assert.deepEqual(braces.expand(input), expected);
    assert.deepEqual(braces.expand(braces.parse(input)), expected);
    assert.deepEqual(micromatch.braceExpand(input), expected);
  });
}

test("ordinary compilation and parsed subtree stringification retain exact results", () => {
  assert.equal(braces.compile("a/{b,{c,d}}/e"), "a/(b|(c|d))/e");
  assert.equal(braces.compile("file-{01..03}.js"), "file-(0[1-3]).js");
  assert.equal(braces.compile("a/@(b|c)/{d,e}"), "a/@(b|c)/(d|e)");
  const ast = braces.parse("a/{b,c}/d");
  assert.equal(braces.stringify(ast.nodes[2]), "{b,c}");
  assert.equal(braces.compile(ast.nodes[2]), "(b|c)");
  assert.equal(braces.stringify(braces.parse('a/{"b,c",d}')), "a/{b,c,d}");
  assert.equal(braces.stringify("a/\\{b,c\\}", { keepEscaping: true }), "a/\\{b,c\\}");
  assert.deepEqual(braces.expand("{a,a,,b}", { nodupes: true, noempty: true }), ["a", "b"]);
  assert.deepEqual(braces(["{a,b}", "{b,c}"], { expand: true, nodupes: true }), ["a", "b", "c"]);
  assert.throws(() => braces.expand("{1..1001}"), /range limit/);
  assert.throws(() => braces.parse("x".repeat(10001)), /max characters/);
});

test("wide legal input under the original length limit remains accepted", () => {
  const input = "{" + "a,".repeat(4998) + "b}";
  assert.equal(input.length, 9999);
  assert.equal(braces.stringify(input), input);
  assert.equal(braces.compile(input).length, input.length);
  assert.equal(braces.expand(input).length, 4999);
});

function nestedArray(depth = 16000) {
  let value = ["1"];
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}

const astRoutes = {
  compile: (ast) => braces.compile(ast),
  expand: (ast) => braces.expand(ast),
  stringify: (ast) => braces.stringify(ast),
  create: (ast) => braces.create(ast),
  "create expand": (ast) => braces.create(ast, { expand: true }),
  main: (ast) => braces(ast),
  "main expand": (ast) => braces(ast, { expand: true }),
};

for (const [name, route] of Object.entries(astRoutes)) {
  for (const field of ["value", "commas", "ranges"]) {
    test(`${name} rejects complex AST ${field} before implicit coercion`, () => {
      const ast = braces.parse("{a,b}");
      if (field === "value") ast.nodes[1].nodes[1].value = nestedArray();
      else ast.nodes[1][field] = nestedArray();
      assert.throws(() => route(ast), { name: "TypeError", message: `AST ${field} must be a primitive value` });
    });
  }
}

test("create and main never coerce an externally supplied AST length", () => {
  for (const length of [nestedArray(), 0, 2]) {
    const ast = () => ({ ...braces.parse("{a,b}"), length });
    assert.equal(braces.create(ast()), "(a|b)");
    assert.deepEqual(braces(ast()), ["(a|b)"]);
    assert.deepEqual(braces.create(ast(), { expand: true }), ["a", "b"]);
    assert.deepEqual(braces(ast(), { expand: true }), ["a", "b"]);
  }
  assert.deepEqual(braces.create(""), [""]);
  assert.deepEqual(braces.create("{}"), ["{}"]);
});

for (const option of ["step", "rangeLimit"]) {
  const routes = option === "step"
    ? {
      compile: (options) => braces.compile("{1..3}", options),
      expand: (options) => braces.expand("{1..3}", options),
      create: (options) => braces.create("{1..3}", options),
      main: (options) => braces("{1..3}", options),
      "micromatch.parse": (options) => micromatch.parse("{1..3}", options),
      "micromatch.braceExpand": (options) => micromatch.braceExpand("{1..3}", options),
    }
    : {
      expand: (options) => braces.expand("{1..3}", options),
      "create expand": (options) => braces.create("{1..3}", { ...options, expand: true }),
      "main expand": (options) => braces("{1..3}", { ...options, expand: true }),
      "micromatch.braceExpand": (options) => micromatch.braceExpand("{1..3}", options),
    };
  for (const [name, route] of Object.entries(routes)) {
    test(`${name} rejects complex options.${option} before numeric coercion`, () => {
      assert.throws(() => route({ [option]: nestedArray() }),
        { name: "TypeError", message: `options.${option} must be a primitive value` });
    });
  }
}

test("true numeric controls, scalar compatibility and unused maxLength values retain behavior", () => {
  assert.deepEqual(braces.expand("{1..5}", { step: 2 }), ["1", "3", "5"]);
  assert.deepEqual(braces.expand("{1..5}", { step: "2" }), ["1", "3", "5"]);
  assert.deepEqual(braces.expand("{1..5}", { rangeLimit: false }), ["1", "2", "3", "4", "5"]);
  assert.throws(() => braces.expand("{1..5}", { rangeLimit: 2 }), /range limit/);
  assert.throws(() => braces.parse("{a,b}", { maxLength: 4 }), /max characters/);
  for (const input of ["{a,b}", "{a,(b,c)}", "{a,@(b,c)}", "{1..3}"]) {
    assert.doesNotThrow(() => braces.parse(input, { maxLength: nestedArray() }));
    assert.doesNotThrow(() => braces.compile(input));
    assert.doesNotThrow(() => braces.expand(input));
  }
  const scalarAst = { type: "root", nodes: [{ type: "text", value: 3 }] };
  assert.equal(braces.compile(scalarAst), "3");
  assert.equal(braces.stringify(scalarAst), "3");
});
