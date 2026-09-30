'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export interface WrittenLessonMetadata {
  lessonSessionId: string;
  classKey: string;
  instructionVersion: string;
}

interface Props {
  unit: {
    id: string;
    analysisLessonSessionId?: string;
    analysisClassKey?: string;
    analysisInstructionVersion?: string;
  };
  disabled: boolean;
  onSave: (unitId: string, metadata: WrittenLessonMetadata) => Promise<void>;
}

export default function WrittenLessonMetadataEditor({ unit, disabled, onSave }: Props) {
  const [metadata, setMetadata] = useState<WrittenLessonMetadata>({
    lessonSessionId: unit.analysisLessonSessionId || '',
    classKey: unit.analysisClassKey || '',
    instructionVersion: unit.analysisInstructionVersion || '',
  });

  const fields: { key: keyof WrittenLessonMetadata; label: string; placeholder: string }[] = [
    { key: 'lessonSessionId', label: '授業回ID', placeholder: '例: 2026-09-equation-03' },
    { key: 'classKey', label: '匿名クラスキー', placeholder: '例: class-a' },
    { key: 'instructionVersion', label: '指導内容版', placeholder: '例: v1' },
  ];

  return (
    <form className="grid gap-2 rounded border bg-white p-3 sm:grid-cols-3" onSubmit={async event => {
      event.preventDefault();
      await onSave(unit.id, metadata);
    }}>
      {fields.map(field => (
        <label className="grid gap-1 text-xs font-medium text-gray-700" key={field.key}>
          {field.label}
          <input
            className="rounded border px-2 py-1 text-sm"
            value={metadata[field.key]}
            maxLength={80}
            placeholder={field.placeholder}
            disabled={disabled}
            onChange={event => setMetadata(current => ({ ...current, [field.key]: event.target.value }))}
          />
        </label>
      ))}
      <div className="flex items-center gap-2 sm:col-span-3">
        <Button size="sm" type="submit" disabled={disabled}>分析用授業情報を保存</Button>
        <span className="text-xs text-gray-500">今後の提出時に固定されます。クラスキーに氏名を入れないでください。</span>
      </div>
    </form>
  );
}
