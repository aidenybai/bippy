import { LanguageParser } from './LanguageParser.mts';
import type {
  ParseNode,
  ParseNodesByType,
} from './ParseNode.mts';
import { Scope } from './Scope.mts';
import { surroundingAgent, type Feature } from '#self';

export interface ParserOptions {
  readonly source: string;
  readonly decoratingSource?: string;
  readonly specifier?: string;
  readonly json?: boolean;
  readonly allowAllPrivateNames?: boolean;
}

export class Parser extends LanguageParser {
  protected readonly source: string;

  protected readonly specifier?: string;

  readonly state: {
    hasTopLevelAwait: boolean;
    strict: boolean;
    json: boolean;
    allowAllPrivateNames: boolean;
  };

  readonly scope = new Scope(this);

  protected readonly decoratingSource?: string;

  constructor({
    source, specifier, json = false, allowAllPrivateNames = false, decoratingSource,
  }: ParserOptions) {
    super();
    this.source = source;
    this.specifier = specifier;
    this.decoratingSource = decoratingSource;
    this.state = {
      hasTopLevelAwait: false,
      strict: false,
      json,
      allowAllPrivateNames,
    };
  }

  isStrictMode() {
    return this.state.strict;
  }

  feature(name: Feature) {
    return surroundingAgent.feature(name);
  }

  startNode<T extends ParseNode>(inheritStart?: ParseNode.BaseParseNode): ParseNode.Unfinished<T>;

  startNode(inheritStart?: ParseNode.BaseParseNode): ParseNode.Unfinished {
    this.peek();
    const s = this.source;
    const node: ParseNode.BaseParseNode = {
      type: undefined!,
      parent: undefined,
      location: this.getLocation(inheritStart),
      strict: this.state.strict,
      get sourceText() {
        return s.slice(node.location.startIndex, node.location.endIndex);
      },
    };
    return node;
  }

  markNodeStart(node: ParseNode.Unfinished) {
    node.location.startIndex = this.peekToken.startIndex;
    node.location.start = {
      line: this.peekToken.line,
      column: this.peekToken.column,
    };
  }

  finishNode<T extends ParseNode.Unfinished, K extends T['type'] & ParseNode['type']>(node: T, type: K): ParseNodesByType[K];

  finishNode(node: ParseNode.Unfinished, type: ParseNode['type']) {
    node.type = type;
    this.markLocationEnd(node);
    return node;
  }
}
