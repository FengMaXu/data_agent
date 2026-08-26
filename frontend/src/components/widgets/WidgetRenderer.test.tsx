import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WidgetRenderer, { type WidgetSpec } from './WidgetRenderer';

describe('WidgetRenderer chart replay', () => {
    it('renders series points like data points after a widget replay', () => {
        const baseWidget: WidgetSpec = {
            widget_id: 'chart-1',
            kind: 'chart',
            title: 'Sales',
            data: [{ label: 'North', value: 10 }],
        };

        const { rerender } = render(<WidgetRenderer widget={baseWidget} />);
        expect(screen.getByText('North')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();

        rerender(
            <WidgetRenderer
                widget={{
                    ...baseWidget,
                    data: [],
                    series: [{ label: 'South', value: 25, mark: 'bar', metadata: { source: 'replay' } }],
                }}
            />,
        );

        expect(screen.getByText('South')).toBeInTheDocument();
        expect(screen.getByText('25')).toBeInTheDocument();
        expect(screen.queryByText('North')).not.toBeInTheDocument();
    });
});
