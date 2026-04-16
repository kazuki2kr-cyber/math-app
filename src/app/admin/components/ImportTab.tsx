'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Database } from 'lucide-react';

interface ImportTabProps {
  loading: boolean;
  importSubject: string;
  setImportSubject: (v: string) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate: () => void;
}

export default function ImportTab({ loading, importSubject, setImportSubject, onFileUpload, onDownloadTemplate }: ImportTabProps) {
  return (
    <Card className="border-t-4 border-t-primary shadow-sm mt-4">
      <CardHeader>
        <CardTitle>一括問題インポート (CSV)</CardTitle>
        <CardDescription>
          StudyAid等で作成したCSVデータをアップロードし、Firestoreへ一括登録します。同名の単元は上書きされます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 mb-4 bg-gray-50 border p-4 rounded-xl">
          <label className="text-sm font-bold text-gray-700 flex items-center">
            <Database className="w-4 h-4 mr-1" />
            対象教科の選択
          </label>
          <select
            value={importSubject}
            onChange={(e) => setImportSubject(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-2 bg-white font-medium focus:border-primary outline-none"
          >
            <option value="math">数学</option>
            <option value="english">英語</option>
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            ※アップロードするCSVデータすべてにこの教科が設定されます。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <Input
            type="file"
            accept=".csv"
            onChange={onFileUpload}
            disabled={loading}
            className="flex-1"
          />
          <Button variant="outline" onClick={onDownloadTemplate} type="button">
            テンプレートをダウンロード
          </Button>
        </div>

        <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded mt-4">
          <p className="font-semibold mb-2 text-gray-700">要求フォーマット</p>
          <ul className="list-disc list-inside space-y-2">
            <li>必須カラム: <code className="bg-white px-1 py-0.5 border rounded">unit_id</code>, <code className="bg-white px-1 py-0.5 border rounded">question_text</code>, <code className="bg-white px-1 py-0.5 border rounded">options</code>, <code className="bg-white px-1 py-0.5 border rounded">answer_index</code></li>
            <li>任意カラム: <code className="bg-white px-1 py-0.5 border rounded">category</code> (分野。空の場合は「1.正の数と負の数」として登録されます)</li>
            <li><code className="bg-white px-1 py-0.5 border rounded">question_text</code> や解説はLaTeX記述（$数式$など）対応。</li>
            <li><code className="bg-white px-1 py-0.5 border rounded">options</code> は <code>{`["選択1", "選択2"]`}</code> のJSON形式を推奨（カンマ区切りも可）。</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
