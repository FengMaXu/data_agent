import { Clock, Key, ListTree } from '../../icons/Typicons';
import { useLanguage } from '../../../context/LanguageContext';
import type { ColumnView } from '../types';

function FieldRow({ column }: { column: ColumnView }) {
    const { t } = useLanguage();
    return (
        <div className="semantic-field-row">
            <div className="semantic-field-name">
                {column.isGrain && <Key size={13} className="semantic-grain-icon" />}
                {column.role === 'time' && !column.isGrain && <Clock size={13} className="semantic-time-icon" />}
                <span>{column.name}</span>
            </div>
            <div className="semantic-field-detail">
                {column.type && <span className="semantic-type-badge">{column.type}</span>}
                {column.inherited && <span className="semantic-inherited-badge">{t('semantic.inheritedFromManifest')}</span>}
                {column.primaryDescription && <span className="semantic-field-description">{column.primaryDescription}</span>}
            </div>
        </div>
    );
}

function FieldGroup({ title, icon, columns }: { title: string; icon: React.ReactNode; columns: ColumnView[] }) {
    if (columns.length === 0) return null;
    return (
        <div className="semantic-field-group">
            <div className="semantic-field-group-title">{icon}{title} <span className="semantic-count">{columns.length}</span></div>
            <div className="semantic-field-list">{columns.map((column) => <FieldRow key={column.name} column={column} />)}</div>
        </div>
    );
}

export function ColumnFieldGroup({ columns }: { columns: ColumnView[] }) {
    const { t } = useLanguage();
    const grain = columns.filter((column) => column.isGrain);
    const time = columns.filter((column) => !column.isGrain && column.role === 'time');
    const defaults = columns.filter((column) => !column.isGrain && column.role !== 'time');

    return (
        <section className="semantic-section">
            <div className="semantic-section-heading">
                <span className="semantic-section-icon"><ListTree size={15} /></span>
                <h2>{t('semantic.fields')} <span className="semantic-count">{columns.length}</span></h2>
            </div>
            {columns.length === 0 ? (
                <p className="semantic-empty">{t('semantic.noFields')}</p>
            ) : (
                <div className="semantic-field-groups">
                    <FieldGroup title="Grain" icon={<Key size={13} />} columns={grain} />
                    <FieldGroup title="Time" icon={<Clock size={13} />} columns={time} />
                    <FieldGroup title="Default" icon={<ListTree size={13} />} columns={defaults} />
                </div>
            )}
        </section>
    );
}
