'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface KanjiImportTabProps {
  loading: boolean;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate: () => void;
}

export default function KanjiImportTab({ loading, onFileUpload, onDownloadTemplate }: KanjiImportTabProps) {
  return (
    <Card className="border-t-4 border-t-orange-500 shadow-sm mt-4 font-serif">
      <CardHeader>
        <CardTitle className="text-orange-950">漢字ドリル 一括インポート (CSV)</CardTitle>
        <CardDescription>
          漢字のCSVデータをアップロードし、Firestoreへ一括登録します。同名の単元は上書きされます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <Input
            type="file"
            accept=".csv"
            onChange={onFileUpload}
            disabled={loading}
            className="flex-1"
          />
          <Button variant="outline" onClick={onDownloadTemplate} type="button" className="border-orange-200 text-orange-900 border-2">
            テンプレートをダウンロード
          </Button>
        </div>

        <div className="text-sm text-orange-900/80 bg-orange-50 p-4 rounded mt-4">
          <p className="font-semibold mb-2 text-orange-950">要求フォーマット</p>
          <ul className="list-disc list-inside space-y-2">
            <li>必須カラム: <code className="bg-white px-1 py-0.5 border border-orange-200 rounded">unit_id</code>, <code className="bg-white px-1 py-0.5 border border-orange-200 rounded">question_text</code>, <code className="bg-white px-1 py-0.5 border border-orange-200 rounded">answer</code></li>
            <li>任意カラム: <code className="bg-white px-1 py-0.5 border border-orange-200 rounded">title</code>, <code className="bg-white px-1 py-0.5 border border-orange-200 rounded">explanation</code></li>
            <li><code className="bg-white px-1 py-0.5 border border-orange-200 rounded">answer</code> には複数文字（例: 「山川」など2文字以上）が入っても構いません。</li>
            <li><code className="bg-white px-1 py-0.5 border border-orange-200 rounded">unit_id</code> が同じものは1つの単元としてグループ化されます。</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
