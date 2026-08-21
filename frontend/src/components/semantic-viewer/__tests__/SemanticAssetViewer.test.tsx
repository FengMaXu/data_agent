import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SemanticAssetViewer } from '../SemanticAssetViewer';
import { SourceKindBadge } from '../components/SourceKindBadge';
import type { SemanticSourceKind, SemanticSourceViewDto } from '../types';

function makeDto(overrides: Partial<SemanticSourceViewDto> = {}): SemanticSourceViewDto {
    return {
        connectionId: 'warehouse',
        sourceName: 'orders',
        sourceKind: 'standalone',
        assetType: 'semantic_model',
        title: null,
        isQueryable: true,
        rawYaml: 'name: orders\ntable: analytics.orders\n',
        table: 'analytics.orders',
        sql: null,
        descriptions: { user: '订单事实模型' },
        primaryDescription: '订单事实模型',
        descriptionProvenance: 'user',
        grain: ['id'],
        columns: [
            {
                name: 'id',
                type: 'number',
                role: 'default',
                descriptions: {},
                primaryDescription: null,
                descriptionProvenance: null,
                isGrain: true,
                inherited: false,
            },
        ],
        measures: [
            {
                name: 'order_count',
                expr: 'count(*)',
                description: '订单数',
                filter: null,
                segments: null,
            },
        ],
        segments: [],
        joins: [
            {
                to: 'customers',
                on: 'orders.customer_id = customers.id',
                relationship: 'many_to_one',
                alias: null,
            },
        ],
        tags: ['mart'],
        defaultTimeDimension: null,
        sourceDocuments: [],
        businessRules: [],
        queryTemplates: [],
        ...overrides,
    };
}

describe('SemanticAssetViewer', () => {
    it('renders raw YAML and deterministic semantic cards', () => {
        render(<SemanticAssetViewer dto={makeDto()} />);

        expect(screen.getByLabelText('orders YAML 原文')).toHaveTextContent('name: orders');
        expect(screen.getByText('订单事实模型')).toBeInTheDocument();
        expect(screen.getByText('count(*)')).toBeInTheDocument();
        expect(screen.getByText('订单数')).toBeInTheDocument();
        expect(screen.getByText('many_to_one')).toBeInTheDocument();
        expect(screen.getByText('Grain')).toBeInTheDocument();
    });

    it('shows a manifest-only placeholder and inherited fields', () => {
        render(
            <SemanticAssetViewer
                dto={makeDto({
                    sourceKind: 'manifest_only',
                    rawYaml: '',
                    columns: [{ ...makeDto().columns[0], inherited: true }],
                })}
            />,
        );

        expect(screen.getByText('此模型由系统 manifest 定义')).toBeInTheDocument();
        expect(screen.getByText('继承自 manifest')).toBeInTheDocument();
    });

    it('renders every source kind badge', () => {
        const cases: Array<[SemanticSourceKind, string]> = [
            ['standalone', '独立模型'],
            ['manifest_only', '系统 manifest'],
            ['manifest_with_overlay', '含覆盖层'],
            ['standalone_shadows_manifest', '遮蔽 manifest'],
            ['orphan_overlay', '孤立覆盖层'],
        ];

        for (const [kind, label] of cases) {
            const { unmount } = render(<SourceKindBadge kind={kind} />);
            expect(screen.getByText(label)).toBeInTheDocument();
            unmount();
        }
    });

    it('renders manually ingested business rules and SQL templates', () => {
        render(
            <SemanticAssetViewer
                dto={makeDto({
                    assetType: 'business_knowledge',
                    sourceName: 'qianhai_business_knowledge',
                    title: '前海业务规则与 SQL 查询模板',
                    isQueryable: false,
                    table: null,
                    rawYaml: 'asset_type: business_knowledge',
                    sourceDocuments: ['knowledge/doc/business.md'],
                    businessRules: [{
                        id: 'yoy',
                        name: '汇总同比增速必须重新计算',
                        statement: '先汇总再计算同比。',
                        severity: 'critical',
                        source: 'knowledge/doc/business.md',
                        details: ['禁止平均个体增速'],
                    }],
                    queryTemplates: [{
                        id: 'template-1',
                        name: '行业大类累计销售额',
                        category: '行业大类',
                        description: '按行业和月份查询',
                        parameters: [{ name: 'target_month', description: '目标月份' }],
                        sql: 'SELECT SUM(sales_ytd) FROM fact_sales_monthly',
                        semanticModels: ['industry_sales_summary'],
                        executionStatus: 'advisory',
                        notes: [],
                    }],
                })}
            />,
        );

        expect(screen.getByText('业务规则')).toBeInTheDocument();
        expect(screen.getByText('汇总同比增速必须重新计算')).toBeInTheDocument();
        expect(screen.getByText('SQL 查询模板')).toBeInTheDocument();
        expect(screen.getByText('行业大类累计销售额')).toBeInTheDocument();
        expect(screen.getByText('@target_month')).toBeInTheDocument();
    });

    it('switches between code and visual modes', () => {
        const { container } = render(<SemanticAssetViewer dto={makeDto()} />);
        const codeButton = screen.getByRole('button', { name: /代码/ });
        const visualButton = screen.getByRole('button', { name: /可视化/ });

        fireEvent.click(codeButton);
        expect(container.querySelector('.semantic-viewer-body')?.className).toContain('mode-code');
        expect(codeButton).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(visualButton);
        expect(container.querySelector('.semantic-viewer-body')?.className).toContain('mode-visual');
        expect(visualButton).toHaveAttribute('aria-pressed', 'true');
    });
});
