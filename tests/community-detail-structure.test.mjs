import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_COMMUNITY_COMMENTS,
  DEFAULT_COMMUNITY_POSTS,
} from "../src/data/socialFixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypeSource = readFileSync(path.join(root, "src/Prototype.tsx"), "utf8");
const prototypeStyles = readFileSync(path.join(root, "src/prototype.css"), "utf8");

function functionBlock(source, functionName) {
  const declaration = `function ${functionName}`;
  const declarationIndex = source.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, `${functionName} declaration must exist`);

  const openingParenthesis = source.indexOf("(", declarationIndex + declaration.length);
  assert.notEqual(openingParenthesis, -1, `${functionName} must declare parameters`);

  let parenthesisDepth = 0;
  let closingParenthesis = -1;
  for (let index = openingParenthesis; index < source.length; index += 1) {
    if (source[index] === "(") parenthesisDepth += 1;
    if (source[index] === ")") parenthesisDepth -= 1;
    if (parenthesisDepth === 0) {
      closingParenthesis = index;
      break;
    }
  }

  assert.notEqual(closingParenthesis, -1, `${functionName} parameter list must be balanced`);
  const openingBrace = source.indexOf("{", closingParenthesis + 1);
  assert.notEqual(openingBrace, -1, `${functionName} must have a body`);

  let braceDepth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") braceDepth += 1;
    if (source[index] === "}") braceDepth -= 1;
    if (braceDepth === 0) return source.slice(declarationIndex, index + 1);
  }

  assert.fail(`${functionName} function body is not balanced`);
}

test("every seeded community post has example comments for its detail page", () => {
  for (const post of DEFAULT_COMMUNITY_POSTS) {
    const comments = DEFAULT_COMMUNITY_COMMENTS[post.id];
    assert.ok(Array.isArray(comments), `${post.id} needs a comment fixture`);
    assert.ok(comments.length >= 2, `${post.id} needs at least two visible example comments`);
    assert.equal(new Set(comments.map((comment) => comment.id)).size, comments.length);
    for (const comment of comments) {
      assert.ok(comment.author.trim());
      assert.ok(comment.body.trim());
      assert.ok(comment.time.trim());
    }
  }
});

test("community feed pushes a footer-free detail FlowScreen for each post", () => {
  const rootScreen = functionBlock(prototypeSource, "createCommunityScreen");
  const detailScreen = functionBlock(prototypeSource, "createCommunityPostScreen");
  const communityPage = functionBlock(prototypeSource, "CommunityPage");

  assert.match(rootScreen, /render:\s*\(flow\)\s*=>\s*<CommunityPage\s+flow=\{flow\}\s*\/>/);
  assert.match(detailScreen, /id:\s*`community-post-\$\{postId\}`/);
  assert.match(detailScreen, /<BackHeader\s+title="게시글"\s+onBack=\{flow\.pop\}\s*\/>/);
  assert.match(detailScreen, /<CommunityPostDetailPage\s+postId=\{postId\}\s*\/>/);
  assert.doesNotMatch(detailScreen, /RootTabFooter|AppBottomNavigation/);
  assert.match(communityPage, /flow\.push\(createCommunityPostScreen\(post\.id\)\)/);
  assert.match(communityPage, /aria-label=\{`\$\{post\.title\} 상세 보기`\}/);
});

test("community detail renders the full post, shared reactions, comments, and a keyboard-aware composer", () => {
  const detailPage = functionBlock(prototypeSource, "CommunityPostDetailPage");

  assert.match(detailPage, /communityPosts\.find\(\(item\)\s*=>\s*item\.id\s*===\s*postId\)/);
  assert.match(detailPage, /communityComments\[post\.id\]\s*\?\?\s*\[\]/);
  assert.match(detailPage, /toggleCommunityPostLike\(post\.id\)/);
  assert.match(detailPage, /addCommunityComment\(post\.id, body\)/);
  assert.match(detailPage, /<KeyboardTextarea\b/);
  assert.match(detailPage, /role="status">\{submitMessage\}/);
  assert.match(detailPage, /새로고침하면 작성 내용이 초기화됩니다/);
  assert.doesNotMatch(detailPage, /RootTabFooter|AppBottomNavigation/);

  for (const className of [
    ".community-detail-page",
    ".community-detail-article",
    ".community-comment-list",
    ".community-comment-form",
  ]) {
    assert.match(prototypeStyles, new RegExp(className.replace(".", "\\.")));
  }
});
