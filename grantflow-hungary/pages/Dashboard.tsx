import React from 'react';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid 
} from 'recharts';
import { Euro, FileText, CheckCircle, Clock } from 'lucide-react';
import StatsCard from '../components/StatsCard';

const dataStatus = [
  { name: 'Planning', value: 4, color: '#3b82f6' },
  { name: 'Drafting', value: 3, color: '#8b5cf6' },
  { name: 'Submitted', value: 2, color: '#f59e0b' },
  { name: 'Awarded', value: 1, color: '#10b981' },
];

const dataFunding = [
  { name: 'Jan', amount: 4000 },
  { name: 'Feb', amount: 3000 },
  { name: 'Mar', amount: 2000 },
  { name: 'Apr', amount: 2780 },
  { name: 'May', amount: 1890 },
  { name: 'Jun', amount: 2390 },
];

const Dashboard: React.FC = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <header className="mb-8">
        <h2 className="text-2xl font-bold text-primary">Overview</h2>
        <p className="text-slate-500">Welcome back, Research Admin. Here is what's happening today.</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard 
          title="Total Grants Active" 
          value="12" 
          icon={<FileText className="w-6 h-6" />} 
          trend="+2 this month" 
          trendUp={true} 
        />
        <StatsCard 
          title="Funding Secured (YTD)" 
          value="€1.2M" 
          icon={<Euro className="w-6 h-6" />} 
          trend="+15% vs last year" 
          trendUp={true} 
        />
        <StatsCard 
          title="Pending Tasks" 
          value="34" 
          icon={<Clock className="w-6 h-6" />} 
          trend="5 due today" 
          trendUp={false} 
        />
        <StatsCard 
          title="Success Rate" 
          value="28%" 
          icon={<CheckCircle className="w-6 h-6" />} 
          trend="Industry avg: 22%" 
          trendUp={true} 
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-primary mb-4">Application Status</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={dataStatus}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {dataStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2">
            {dataStatus.map((entry, index) => (
              <div key={index} className="flex items-center text-sm text-slate-600">
                <span className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: entry.color }}></span>
                {entry.name}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-primary mb-4">Projected Funding Pipeline (k€)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataFunding}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', color: '#fff', borderRadius: '8px' }}
                  cursor={{ fill: '#f1f5f9' }}
                />
                <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
