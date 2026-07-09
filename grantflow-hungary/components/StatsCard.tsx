import React, { ReactNode } from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  trend?: string;
  trendUp?: boolean;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon, trend, trendUp }) => {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-start justify-between">
      <div>
        <p className="text-slate-500 text-sm font-medium mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-slate-800">{value}</h3>
        {trend && (
          <p className={`text-xs font-medium mt-2 ${trendUp ? 'text-success' : 'text-red-500'}`}>
            {trend}
          </p>
        )}
      </div>
      <div className="p-3 bg-slate-50 rounded-lg text-slate-600">
        {icon}
      </div>
    </div>
  );
};

export default StatsCard;
