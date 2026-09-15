  $.dynatableSetup({
		features:{
			pushState:false
		},
	inputs: {
		paginationPrev: '<',
		paginationNext: '>',
		paginationGap: [1,2,2,1],
		searchTarget: null,
		searchPlacement: 'before',
		perPageTarget: null,
		perPagePlacement: 'before',
		perPageText: ' ',
		recordCountText: ' ',
		processingText: '...'
	}
	});
	

	var indexSort = function(a, b, attr, direction) {
		if( isNaN(a[attr])){
			return 1;
		}
		if( isNaN(b[attr])){
			return 1;
		}

		var comparison = Number(a[attr]) > Number(b[attr])? 1:-1;
		
		return direction > 0 ? comparison : -comparison;
	};
	

Reporter = function(){
	
	var dyCurrent =null;

	$(".sidebar").on("click", ".nav-link", function(){
		
		var $this = $(this), 
				 url = $this.data("apiSource") +  ".json",
				 target = $this.data("apiTarget");

		$this.tab('show');
		_loadData(url, target);
	});

	var _loadData = function( url, tableElement ){
		$.ajax({
			url: url, 
			dataType : "json",
			cache : false,
			processData :false,
			success:  function( data ){
				var $table = $(tableElement);
				
				// $table.bind('dynatable:init', function(e, dynatable) {
				// 	dynatable.sorts.functions["index"] = indexSort;					
				// });

				var dyConfigs = { 
					dataset: {
						records: data, 
						perPageDefault: 25,						
						sortTypes: {
							index: 'index'
						}						
					 }
				}

				if( $(tableElement).data('pageSize') != null){
					dyConfigs.dataset.perPageDefault =$(tableElement).data('pageSize') 
				}

				if( $table.data('sort' ) != null ){
					dyConfigs.dataset.sorts ={};
					dyConfigs.dataset.sorts[$table.data('sort' )]=$table.data('dir') == 'ASC'? 1:-1;
				}

				if($table.data('sortEnabled') != null){
					dyConfigs.features = {}
					dyConfigs.features.sort = $table.data('sortEnabled');
				}
				
				$table.dynatable(dyConfigs);					 
			}
		}).done(function(){console.log("done")});
	}
		
		$($(".nav-link")[0]).click();
};	
