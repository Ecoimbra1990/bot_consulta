import type { CrudField } from '../components/CrudDialog';

export const queryFields: CrudField[] = [
  {
    name: 'entity',
    label: 'Entidade',
    type: 'select',
    options: [
      { value: 'PF', label: 'PF' },
      { value: 'EMPRESA', label: 'Empresa' },
      { value: 'TELEFONE', label: 'Telefone' },
      { value: 'VEICULO', label: 'Veículo' },
      { value: 'VEICULO_FROTA', label: 'Frota' },
    ],
  },
  { name: 'key_type', label: 'Tipo de chave' },
  { name: 'key_masked', label: 'Chave mascarada' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'pending', label: 'Pendente' },
      { value: 'completed', label: 'Concluída' },
      { value: 'failed', label: 'Falhou' },
    ],
  },
  { name: 'cost_cents', label: 'Custo (centavos)', type: 'number' },
  { name: 'charged_cents', label: 'Cobrado (centavos)', type: 'number' },
  { name: 'module_key', label: 'Módulo' },
  { name: 'error', label: 'Erro' },
];
