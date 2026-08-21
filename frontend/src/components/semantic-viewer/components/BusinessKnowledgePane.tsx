import { BookOpen, Code2, ListChecks } from 'lucide-react';
import type { BusinessRuleView, QueryTemplateView, SemanticSourceViewDto } from '../types';

function RuleList({ rules }: { rules: BusinessRuleView[] }) {
    if (rules.length === 0) return null;
    return (
        <section className="semantic-section business-knowledge-section">
            <div className="semantic-section-heading">
                <span className="semantic-section-icon"><ListChecks size={15} /></span>
                <h2>业务规则 <span className="semantic-count">{rules.length}</span></h2>
            </div>
            <div className="business-rule-list">
                {rules.map((rule) => (
                    <article className={`business-rule-card severity-${rule.severity}`} key={rule.id}>
                        <div className="business-rule-header">
                            <strong>{rule.name}</strong>
                            <span className="business-rule-severity">{rule.severity}</span>
                        </div>
                        <p>{rule.statement}</p>
                        {rule.details.length > 0 && (
                            <ul>
                                {rule.details.map((detail) => <li key={detail}>{detail}</li>)}
                            </ul>
                        )}
                        {rule.source && <small>来源：{rule.source}</small>}
                    </article>
                ))}
            </div>
        </section>
    );
}

function TemplateCard({ template }: { template: QueryTemplateView }) {
    return (
        <details className="business-template-card">
            <summary>
                <span className="business-template-title">{template.name}</span>
                {template.category && <span className="business-template-category">{template.category}</span>}
                <span className="business-template-status">{template.executionStatus}</span>
            </summary>
            <div className="business-template-body">
                {template.description && <p>{template.description}</p>}
                {template.parameters.length > 0 && (
                    <div className="business-template-parameters">
                        <strong>参数</strong>
                        {template.parameters.map((parameter) => (
                            <span className="business-template-parameter" title={parameter.description} key={parameter.name}>
                                @{parameter.name}
                            </span>
                        ))}
                    </div>
                )}
                {template.semanticModels.length > 0 && (
                    <div className="business-template-models">
                        关联模型：{template.semanticModels.join('、')}
                    </div>
                )}
                <pre className="business-template-sql"><code>{template.sql}</code></pre>
                {template.notes.length > 0 && (
                    <ul className="business-template-notes">
                        {template.notes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                )}
            </div>
        </details>
    );
}

function TemplateList({ templates }: { templates: QueryTemplateView[] }) {
    if (templates.length === 0) return null;
    return (
        <section className="semantic-section business-knowledge-section">
            <div className="semantic-section-heading">
                <span className="semantic-section-icon"><Code2 size={15} /></span>
                <h2>SQL 查询模板 <span className="semantic-count">{templates.length}</span></h2>
            </div>
            <div className="business-template-list">
                {templates.map((template) => <TemplateCard key={template.id} template={template} />)}
            </div>
        </section>
    );
}

export function BusinessKnowledgePane({ dto }: { dto: SemanticSourceViewDto }) {
    if (dto.assetType !== 'business_knowledge') return null;
    return (
        <>
            {dto.sourceDocuments.length > 0 && (
                <section className="business-source-documents">
                    <BookOpen size={14} />
                    <span>已摄取来源：{dto.sourceDocuments.join('、')}</span>
                </section>
            )}
            <RuleList rules={dto.businessRules} />
            <TemplateList templates={dto.queryTemplates} />
        </>
    );
}
