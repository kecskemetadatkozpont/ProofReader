import React, { useState } from 'react';
import { Student } from '../types';
import { Search, ChevronRight, Plus } from 'lucide-react';

interface StudentListProps {
  students: Student[];
  onSelectStudent: (student: Student) => void;
  onAddStudent: () => void;
}

export const StudentList: React.FC<StudentListProps> = ({ students, onSelectStudent, onAddStudent }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredStudents = students.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.topic.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.supervisor.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h2 className="text-2xl font-bold text-slate-800">Hallgatói Nyilvántartás</h2>
        <button 
          onClick={onAddStudent}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus size={18} />
          Új hallgató felvétele
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="Keresés név, téma vagy témavezető alapján..." 
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all bg-slate-50 text-slate-900 placeholder-slate-400"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Hallgató</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Témavezető</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Státusz</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Kredit / Cél</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredStudents.map((student) => (
              <tr 
                key={student.id} 
                onClick={() => onSelectStudent(student)}
                className="hover:bg-slate-50 cursor-pointer transition-colors group"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <img src={student.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                    <div>
                      <p className="font-semibold text-slate-900">{student.name}</p>
                      <p className="text-xs text-slate-500 truncate max-w-[200px]">{student.topic}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 hidden md:table-cell">
                  {student.supervisor}
                </td>
                <td className="px-6 py-4 hidden lg:table-cell">
                   <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                     ${student.status === 'Aktív' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}`}>
                     {student.status}
                   </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-bold text-slate-700">{student.totalCredits}</span>
                    <span className="text-xs text-slate-400">/ {student.requiredCredits}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right text-slate-400 group-hover:text-blue-600">
                   <ChevronRight size={20} />
                </td>
              </tr>
            ))}
            {filteredStudents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  Nincs találat a keresési feltételekre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};