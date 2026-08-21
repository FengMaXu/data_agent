export type SemanticSourceKind =
    | 'standalone'
    | 'manifest_only'
    | 'manifest_with_overlay'
    | 'standalone_shadows_manifest'
    | 'orphan_overlay';

export interface ColumnView {
    name: string;
    type: string | null;
    role: string | null;
    descriptions: Record<string, string>;
    primaryDescription: string | null;
    descriptionProvenance: string | null;
    isGrain: boolean;
    inherited: boolean;
}

export interface MeasureView {
    name: string;
    expr: string;
    description: string | null;
    filter: string | null;
    segments: string[] | null;
}

export interface SegmentView {
    name: string;
    expr: string;
    description: string | null;
}

export interface JoinView {
    to: string;
    on: string;
    relationship: string;
    alias: string | null;
}

export type SemanticAssetType = 'semantic_model' | 'business_knowledge';

export interface BusinessRuleView {
    id: string;
    name: string;
    statement: string;
    severity: string;
    source: string;
    details: string[];
}

export interface QueryTemplateParameterView {
    name: string;
    description: string;
}

export interface QueryTemplateView {
    id: string;
    name: string;
    category: string;
    description: string;
    parameters: QueryTemplateParameterView[];
    sql: string;
    semanticModels: string[];
    executionStatus: string;
    notes: string[];
}

export interface SemanticSourceSummary {
    sourceName: string;
    sourceKind: SemanticSourceKind;
    assetType: SemanticAssetType;
    title: string | null;
    isQueryable: boolean;
    hasOverlay: boolean;
    description: string;
}

export interface SemanticConnection {
    connectionId: string;
    sources: SemanticSourceSummary[];
}

export interface SemanticSourcesResponse {
    connections: SemanticConnection[];
}

export interface SemanticSourceViewDto {
    connectionId: string;
    sourceName: string;
    sourceKind: SemanticSourceKind;
    assetType: SemanticAssetType;
    title: string | null;
    isQueryable: boolean;
    rawYaml: string;
    table: string | null;
    sql: string | null;
    descriptions: Record<string, string>;
    primaryDescription: string | null;
    descriptionProvenance: string | null;
    grain: string[];
    columns: ColumnView[];
    measures: MeasureView[];
    segments: SegmentView[];
    joins: JoinView[];
    tags: string[];
    defaultTimeDimension: string | null;
    sourceDocuments: string[];
    businessRules: BusinessRuleView[];
    queryTemplates: QueryTemplateView[];
}
