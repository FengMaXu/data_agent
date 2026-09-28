import React from 'react';
import { RiArrowRightS } from './icons/RemixIcons';

type DepthStyle = React.CSSProperties & { '--depth': number };

const depthStyle = (depth: number): DepthStyle => ({ '--depth': depth });

interface SectionHeaderProps {
    icon: React.ReactNode;
    label: string;
    expanded: boolean;
    onToggle: () => void;
    /** Section-level actions, shown on the header while the section is open. */
    actions?: React.ReactNode;
}

/** A top-level sidebar entry that opens a tree, with its actions on the same row. */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ icon, label, expanded, onToggle, actions }) => (
    <div className={`nav-group ${expanded && actions ? 'has-actions' : ''}`}>
        <button
            type="button"
            className={`nav-item ${expanded ? 'expanded' : ''}`}
            title={label}
            aria-label={label}
            aria-expanded={expanded}
            onClick={onToggle}
        >
            {icon}
            <span className="nav-item-text">{label}</span>
        </button>
        {expanded && actions && <div className="nav-group-actions">{actions}</div>}
    </div>
);

interface TreeActionProps {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    tone?: 'danger';
    preventBlur?: boolean;
}

/** A small icon button used on section headers and tree rows. */
export const TreeAction: React.FC<TreeActionProps> = ({ label, onClick, children, tone, preventBlur }) => (
    <button
        type="button"
        className={`tree-action ${tone === 'danger' ? 'is-danger' : ''}`}
        title={label}
        aria-label={label}
        onMouseDown={preventBlur ? (event) => event.preventDefault() : undefined}
        onClick={onClick}
    >
        {children}
    </button>
);

interface TreeRowProps {
    depth: number;
    icon: React.ReactNode;
    label: React.ReactNode;
    /** Secondary text after the label, such as a document id. */
    secondary?: React.ReactNode;
    title?: string;
    /** Right-aligned detail such as a count or badge. */
    meta?: React.ReactNode;
    /** Omit for a leaf row; true/false renders the disclosure chevron. */
    expanded?: boolean;
    active?: boolean;
    onSelect?: () => void;
    /** Row actions, revealed on hover or focus. */
    actions?: React.ReactNode;
    /** Replaces the row's main button, e.g. with a rename input. */
    editor?: React.ReactNode;
}

export const TreeRow: React.FC<TreeRowProps> = ({
    depth,
    icon,
    label,
    secondary,
    title,
    meta,
    expanded,
    active = false,
    onSelect,
    actions,
    editor,
}) => {
    const expandable = expanded !== undefined;
    const chevron = (
        <span className={`tree-chevron ${expanded ? 'is-open' : ''}`} aria-hidden="true">
            {expandable && <RiArrowRightS size={14} />}
        </span>
    );

    return (
        <div className={`tree-row ${active ? 'is-active' : ''} ${editor ? 'is-editing' : ''}`} style={depthStyle(depth)}>
            {editor ? (
                <div className="tree-row-main">
                    {chevron}
                    <span className="tree-icon" aria-hidden="true">{icon}</span>
                    {editor}
                </div>
            ) : (
                <button
                    type="button"
                    className="tree-row-main"
                    title={title}
                    aria-expanded={expandable ? expanded : undefined}
                    aria-current={active ? 'page' : undefined}
                    onClick={onSelect}
                >
                    {chevron}
                    <span className="tree-icon" aria-hidden="true">{icon}</span>
                    <span className="tree-label">
                        {label}
                        {secondary && <span className="tree-secondary">{secondary}</span>}
                    </span>
                    {meta !== undefined && meta !== null && <span className="tree-meta">{meta}</span>}
                </button>
            )}
            {actions && <span className="tree-actions">{actions}</span>}
        </div>
    );
};

/** Children of a tree row, drawn with a guide line under the parent's chevron. */
export const TreeGroup: React.FC<{ depth: number; children: React.ReactNode }> = ({ depth, children }) => (
    <div className="tree-group" role="group" style={depthStyle(depth)}>
        {children}
    </div>
);

/** A muted line inside a tree for loading and empty states. */
export const TreeNote: React.FC<{ depth: number; children: React.ReactNode; role?: string }> = ({ depth, children, role }) => (
    <div className="tree-note" role={role} style={depthStyle(depth)}>
        {children}
    </div>
);
