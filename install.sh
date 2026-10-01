#!/bin/sh
set -eu
# Run from a downloaded checkout: sh install.sh
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target=${QUEBRAGALHO_BIN_DIR:-"$HOME/.local/bin"}
command -v node >/dev/null 2>&1 || { echo 'Instale Node.js 22+ primeiro.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo 'Requer Node.js 22+.' >&2; exit 1; }
mkdir -p "$target"
if [ -e "$target/quebragalho" ] || [ -L "$target/quebragalho" ]; then
  echo "Já existe $target/quebragalho; instalação interrompida para preservar o arquivo." >&2
  exit 1
fi
install -m 755 "$source_dir/quebragalho.mjs" "$target/quebragalho"
echo "Instalado em $target/quebragalho"
case ":$PATH:" in
  *":$target:"*) ;;
  *) echo "Adicione $target ao PATH do seu terminal." ;;
esac
if [ -t 0 ] && [ "$(uname -s)" = Darwin ]; then
  printf 'Configurar um perfil separado do Quebra-galho para Claude? [S/n] '
  IFS= read -r choice || exit 0
  case "$choice" in
    ''|s|S|y|Y) "$target/quebragalho" setup claude ;;
    *) echo 'Quando quiser: quebragalho setup claude' ;;
  esac
elif [ "$(uname -s)" = Darwin ]; then
  echo 'Para configurar o perfil QG separado: quebragalho setup claude'
else
  echo 'Próximo passo: quebragalho launch (ou quebragalho list)'
fi
